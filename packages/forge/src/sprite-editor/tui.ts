// The `@opentui/core` glue for the Sprite editor (ADR 0031): a single Renderable
// that draws the pure editor state and a `key()` dispatcher that mutates it
// through the pure ops in `state.ts`. All logic lives in the pure modules
// (`state.ts`, `picker.ts`, `view.ts`); this file only wires them to the screen
// buffer and the keyboard, mirroring the zone editor's `editor.ts` structure.
// The Renderable is exported so the TUI can be smoke-tested headlessly with
// `@opentui/core/testing`, exactly like the client's CharacterCreator.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RGBAQuad } from '@mmo/core';
import { SCENE_PALETTE } from '@mmo/core';
import {
	parseSpriteFile,
	SENTINEL,
	type SpriteDiagnostic,
	type SpriteDoc,
} from '@mmo/render';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderContext,
	RGBA,
} from '@opentui/core';
import type { CliDeps } from '../cli';
import { findSpriteFile, formatSpriteDiagnostics } from '../sprite-cli';
import {
	type AnchorMenuAction,
	type AnchorMenuState,
	anchorMenuKey,
	type MenuKey,
	openAnchorMenu,
	openPoseMenu,
	type PoseMenuAction,
	type PoseMenuState,
	type PoseRow,
	poseMenuKey,
	syncPoseMenu,
} from './menus';
import {
	formAdvance,
	formBackspace,
	formInput,
	openPicker as openPickerState,
	type PickerAction,
	type PickerState,
	pickerBack,
	pickerChoose,
	pickerMove,
} from './picker';
import { playbackFrame, poseFps, walkPreviewPose } from './playback';
import {
	addFrameToPose,
	anchorMarkers,
	beginStroke,
	cellAt,
	clearCell,
	createPose,
	defineLocalColor,
	deletePose,
	endStroke,
	erasePixel,
	frameNames,
	initSpriteEditor,
	moveCursor,
	paintPixel,
	paletteEntries,
	pixelToCell,
	placeAnchor,
	poseFrames,
	poseNames,
	redoEdit,
	removeAnchorOverride,
	reorderFrame,
	type SpriteEditorState,
	saveResult,
	selectFrame,
	selectPose,
	setAnchorName,
	setAnchorScope,
	setBgKey,
	setFgKey,
	setPoseFps,
	setTool,
	stampGlyph,
	undoEdit,
} from './state';
import { emptySpriteDoc, type SpriteRole } from './templates';
import {
	ANCHOR_MARKER,
	type Cam,
	dirForRole,
	mirrorAnchorMarkers,
	mirrorRender,
	missingRequiredAnchors,
	parseEditArg,
	quadrantMarker,
	requiredHintLine,
	resolveColorKey,
	roleForDir,
	SPRITE_PREVIEWS,
	saveDiagSummary,
	scrollViewport,
	spriteHelpLine,
	spriteStatusLine,
} from './view';

// A keyboard event as opentui's keyInput delivers it (a subset — see the zone
// editor's EditKey).
export interface SpriteKey {
	name: string;
	sequence?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
	super?: boolean;
	option?: boolean;
}

export interface SpriteEditorOpts {
	id: string;
	role: SpriteRole;
	doc: SpriteDoc;
	frame?: string;
	// Persist the serialized `.sprite` text; the editor never touches disk itself.
	save: (text: string) => void;
	onQuit?: () => void;
	initialDiags?: readonly SpriteDiagnostic[];
	globalPalette?: Readonly<Record<string, RGBAQuad>>;
}

const CHROME_H = 3;
const SCROLLOFF = 2;

// What playback is currently animating.
type PlayMode = 'none' | 'pose' | 'walk';

// Normalize an opentui key event into the modal reducers' MenuKey.
function toMenuKey(k: SpriteKey): MenuKey {
	switch (k.name) {
		case 'up':
		case 'down':
		case 'left':
		case 'right':
			return { name: k.name };
		case 'return':
		case 'enter':
			return { name: 'enter' };
		case 'escape':
			return { name: 'escape' };
		case 'backspace':
			return { name: 'backspace' };
	}
	const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
	if (ch.length === 1) return { name: 'char', char: ch };
	return { name: k.name };
}

export class SpriteEditor extends Renderable {
	state: SpriteEditorState;
	picker: PickerState | null = null;
	poseMenu: PoseMenuState | null = null;
	anchorMenu: AnchorMenuState | null = null;
	mirror = false;
	awaitingStamp = false;
	// Animation playback is presentation only — it never touches the doc/history.
	playMode: PlayMode = 'none';
	private playElapsedMs = 0;
	private penDown = false;
	private cam: Cam = { x: 0, y: 0 };
	private savedDoc: SpriteDoc;
	private saveDiags: readonly SpriteDiagnostic[] | null;
	private saved = false;
	readonly spriteId: string;
	readonly role: SpriteRole;
	private readonly save: (text: string) => void;
	private readonly onQuit?: () => void;
	private readonly globalPalette: Readonly<Record<string, RGBAQuad>>;

	// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
	constructor(ctx: RenderContext | any, opts: SpriteEditorOpts) {
		super(ctx, { width: '100%', height: '100%', live: true });
		this.spriteId = opts.id;
		this.role = opts.role;
		this.state = initSpriteEditor(opts.doc, opts.frame);
		this.savedDoc = opts.doc;
		this.saveDiags = opts.initialDiags ?? null;
		this.save = opts.save;
		this.onQuit = opts.onQuit;
		this.globalPalette = opts.globalPalette ?? SCENE_PALETTE;
	}

	attach(root: { add: (r: Renderable) => void }): void {
		root.add(this);
	}

	private get dirty(): boolean {
		return this.state.doc !== this.savedDoc;
	}

	private entries() {
		return paletteEntries(this.state, this.globalPalette, SPRITE_PREVIEWS);
	}

	// ---- pen / paint ----

	private liftPen(): void {
		if (this.penDown) {
			this.state = endStroke(this.state);
			this.penDown = false;
		}
	}

	private applyAtCursor(): void {
		const { x, y } = this.state.cursor;
		this.state =
			this.state.tool === 'erase'
				? erasePixel(this.state, x, y)
				: paintPixel(this.state, x, y);
	}

	private primary(): void {
		if (this.state.tool === 'anchor') {
			this.placeAnchorAtCursor();
			return;
		}
		if (this.state.tool === 'stamp') {
			this.awaitingStamp = true;
			this.state = { ...this.state, feedback: '' };
			return;
		}
		if (!this.penDown) {
			this.state = beginStroke(this.state);
			this.penDown = true;
			this.applyAtCursor();
		} else {
			this.liftPen();
		}
	}

	private move(dx: number, dy: number): void {
		const { x, y } = this.state.cursor;
		this.state = moveCursor(this.state, x + dx, y + dy);
		if (this.penDown) this.applyAtCursor();
	}

	// ---- picker ----

	private openPicker(slot: 'fg' | 'bg'): void {
		this.liftPen();
		const current = slot === 'fg' ? this.state.fgKey : this.state.bgKey;
		this.picker = openPickerState(slot, this.entries(), current);
	}

	private applyPickerAction(action: PickerAction): void {
		switch (action.type) {
			case 'setFg':
				this.state = setFgKey(this.state, action.key);
				break;
			case 'setBg':
				this.state = setBgKey(this.state, action.key);
				break;
			case 'defineColor': {
				this.state = defineLocalColor(this.state, action.key, action.rgba);
				// Select the freshly defined color into the slot it was made for.
				this.state =
					action.slot === 'fg'
						? setFgKey(this.state, action.key)
						: setBgKey(this.state, action.key);
				break;
			}
			case 'close':
				break;
		}
	}

	private pickerKey(k: SpriteKey): void {
		const p = this.picker;
		if (!p) return;
		if (p.form) {
			if (k.name === 'escape') {
				const res = pickerBack(p);
				this.picker = res.picker;
				if (res.action) this.applyPickerAction(res.action);
			} else if (k.name === 'return' || k.name === 'enter') {
				const res = formAdvance(p);
				this.picker = res.picker;
				if (res.action) this.applyPickerAction(res.action);
			} else if (k.name === 'backspace') {
				this.picker = formBackspace(p);
			} else {
				const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
				if (ch.length === 1) this.picker = formInput(p, ch);
			}
			return;
		}
		if (k.name === 'escape') {
			this.picker = null;
		} else if (k.name === 'up' || k.name === 'k') {
			this.picker = pickerMove(p, -1);
		} else if (k.name === 'down' || k.name === 'j') {
			this.picker = pickerMove(p, 1);
		} else if (
			k.name === 'return' ||
			k.name === 'enter' ||
			k.name === 'space'
		) {
			const res = pickerChoose(p);
			this.picker = res.picker;
			if (res.action) this.applyPickerAction(res.action);
		}
	}

	// ---- stamp ----

	private stampKey(k: SpriteKey): void {
		if (k.name === 'escape') {
			this.awaitingStamp = false;
			return;
		}
		const ch = k.sequence ?? '';
		if ([...ch].length === 1 && ch !== ' ') {
			const { cellX, cellY } = pixelToCell(
				this.state.cursor.x,
				this.state.cursor.y,
			);
			this.state = stampGlyph(this.state, cellX, cellY, ch);
			this.awaitingStamp = false;
		}
	}

	// ---- frames / edits ----

	private stepFrame(delta: number): void {
		this.liftPen();
		const names = frameNames(this.state);
		const i = names.indexOf(this.state.frame);
		const next = names[(i + delta + names.length) % names.length];
		if (next) this.state = selectFrame(this.state, next);
	}

	private clearAtCursor(): void {
		this.liftPen();
		// In the anchor tool, clear drops the current frame's override for the
		// selected anchor (falling back to its doc-level position) rather than
		// clearing a pixel cell.
		if (this.state.tool === 'anchor') {
			if (this.state.anchorName)
				this.state = removeAnchorOverride(this.state, this.state.anchorName);
			return;
		}
		const { cellX, cellY } = pixelToCell(
			this.state.cursor.x,
			this.state.cursor.y,
		);
		this.state = clearCell(this.state, cellX, cellY);
	}

	private doSave(): void {
		this.liftPen();
		const { text, diagnostics } = saveResult(this.state);
		this.save(text);
		this.savedDoc = this.state.doc;
		this.saveDiags = diagnostics;
		this.saved = true;
	}

	private undo(): void {
		this.liftPen();
		this.state = undoEdit(this.state);
	}

	private redo(): void {
		this.liftPen();
		this.state = redoEdit(this.state);
	}

	private switchTool(tool: 'paint' | 'erase' | 'stamp' | 'anchor'): void {
		this.liftPen();
		this.state = setTool(this.state, tool);
	}

	// ---- pose menu ----

	private poseRows(): PoseRow[] {
		return poseNames(this.state).map((name) => ({
			name,
			frameCount: poseFrames(this.state, name).length,
			fps: this.state.doc.fps[name] ?? null,
		}));
	}

	private openPoseMenu(): void {
		this.liftPen();
		this.poseMenu = openPoseMenu(this.poseRows(), this.state.pose);
	}

	private applyPoseAction(action: PoseMenuAction): void {
		switch (action.type) {
			case 'switch':
				this.state = selectPose(this.state, action.pose);
				break;
			case 'create':
				this.state = createPose(this.state, action.name);
				break;
			case 'delete':
				this.state = deletePose(this.state, action.pose);
				break;
			case 'addFrame':
				this.state = addFrameToPose(this.state, action.pose);
				break;
			case 'reorder':
				this.state = reorderFrame(
					this.state,
					action.pose,
					action.index,
					action.delta,
				);
				break;
			case 'setFps':
				this.state = setPoseFps(this.state, action.pose, action.fps);
				break;
			case 'close':
				break;
		}
	}

	private poseMenuKeyDispatch(k: SpriteKey): void {
		const menu = this.poseMenu;
		if (!menu) return;
		const res = poseMenuKey(menu, toMenuKey(k));
		if (res.action && res.action.type !== 'close') {
			const keep = res.action.type === 'create' ? res.action.name : undefined;
			this.applyPoseAction(res.action);
			// 'switch' closes the menu; everything else stays open, re-synced.
			if (res.action.type === 'switch') this.poseMenu = null;
			else this.poseMenu = syncPoseMenu(menu, this.poseRows(), keep);
		} else {
			this.poseMenu = res.menu;
		}
	}

	// ---- anchor menu ----

	private anchorCandidates(): string[] {
		// Required-for-role names first, then any already-declared anchors.
		const required = missingRequiredAnchors(this.state.doc, this.role);
		const declared = anchorMarkers(this.state).map((m) => m.name);
		const seen = new Set<string>();
		const out: string[] = [];
		for (const n of [...required, ...declared]) {
			if (seen.has(n)) continue;
			seen.add(n);
			out.push(n);
		}
		return out;
	}

	private openAnchorMenu(): void {
		this.liftPen();
		this.anchorMenu = openAnchorMenu(
			this.anchorCandidates(),
			this.state.anchorName,
			this.state.anchorScope,
		);
	}

	private applyAnchorAction(action: AnchorMenuAction): void {
		if (action.type === 'select') {
			this.state = setAnchorName(this.state, action.name);
			this.state = setAnchorScope(this.state, action.scope);
			this.state = setTool(this.state, 'anchor');
		}
	}

	private anchorMenuKeyDispatch(k: SpriteKey): void {
		const menu = this.anchorMenu;
		if (!menu) return;
		const res = anchorMenuKey(menu, toMenuKey(k));
		this.anchorMenu = res.menu;
		if (res.action) this.applyAnchorAction(res.action);
	}

	private placeAnchorAtCursor(): void {
		const { cellX, cellY } = pixelToCell(
			this.state.cursor.x,
			this.state.cursor.y,
		);
		if (!this.state.anchorName) {
			this.state = { ...this.state, feedback: 'pick an anchor first (A)' };
			return;
		}
		this.state = placeAnchor(
			this.state,
			this.state.anchorName,
			cellX,
			cellY,
			this.state.anchorScope,
		);
	}

	// ---- playback (presentation only) ----

	private togglePlay(mode: 'pose' | 'walk'): void {
		this.liftPen();
		this.playMode = this.playMode === mode ? 'none' : mode;
		this.playElapsedMs = 0;
	}

	// Advance the playback clock and repaint. Public so tests can drive elapsed
	// time deterministically; the render loop calls it (via the renderer's frame
	// callback in `runSpriteEdit`) with the real per-frame delta.
	tick(deltaMs: number): void {
		if (this.playMode === 'none') return;
		this.playElapsedMs += deltaMs;
		this.requestRender();
	}

	// Whether playback is running (the frame callback only ticks when it is).
	get playing(): boolean {
		return this.playMode !== 'none';
	}

	// The frame the canvas/mirror show this instant — the edit frame when idle,
	// or the animated frame while playing. Never mutates state.
	get displayFrame(): string {
		if (this.playMode === 'walk') {
			const pose = walkPreviewPose(this.playElapsedMs / 1000);
			const frames = poseFrames(this.state, pose);
			return frames[0] ?? this.state.frame;
		}
		if (this.playMode === 'pose') {
			const frames = poseFrames(this.state, this.state.pose);
			if (frames.length === 0) return this.state.frame;
			const fps = poseFps(this.state.doc.fps, this.state.pose);
			const idx = playbackFrame(frames.length, this.playElapsedMs / 1000, fps);
			return frames[idx] ?? this.state.frame;
		}
		return this.state.frame;
	}

	// The single keyboard entry point.
	key(k: SpriteKey): void {
		if (this.picker) {
			this.pickerKey(k);
			return;
		}
		if (this.poseMenu) {
			this.poseMenuKeyDispatch(k);
			return;
		}
		if (this.anchorMenu) {
			this.anchorMenuKeyDispatch(k);
			return;
		}
		if (this.awaitingStamp) {
			this.stampKey(k);
			return;
		}
		// While playing, only playback/mirror/quit keys are honored; anything that
		// would edit is refused so the doc/history stay untouched.
		if (this.playMode !== 'none') {
			if (k.name === 'q') {
				this.onQuit?.();
				return;
			}
			if (k.name === 'm') {
				this.mirror = !this.mirror;
				return;
			}
			if (k.sequence === '.') {
				this.togglePlay('pose');
				return;
			}
			if (k.sequence === ',') {
				this.togglePlay('walk');
				return;
			}
			this.state = {
				...this.state,
				feedback: 'playback active — press . or , to stop',
			};
			return;
		}

		if (k.ctrl && k.name === 's') {
			this.doSave();
			return;
		}
		const cmd = k.super === true || k.meta === true || k.option === true;
		if ((k.ctrl || cmd) && k.name === 'z') {
			if (k.shift) this.redo();
			else this.undo();
			return;
		}
		if ((k.ctrl || cmd) && (k.name === 'r' || k.name === 'y')) {
			this.redo();
			return;
		}
		if (k.name === 'u') {
			if (k.shift) this.redo();
			else this.undo();
			return;
		}
		if (k.sequence === 'U') {
			this.redo();
			return;
		}
		// Poses / anchors / mirror / playback (checked by sequence so shift/plain
		// variants are unambiguous).
		if (k.sequence === 'P') {
			this.openPoseMenu();
			return;
		}
		if (k.sequence === 'A') {
			this.openAnchorMenu();
			return;
		}
		if (k.name === 'm') {
			this.mirror = !this.mirror;
			return;
		}
		if (k.sequence === '.') {
			this.togglePlay('pose');
			return;
		}
		if (k.sequence === ',') {
			this.togglePlay('walk');
			return;
		}

		switch (k.name) {
			case 'left':
			case 'h':
				this.move(-1, 0);
				return;
			case 'right':
			case 'l':
				this.move(1, 0);
				return;
			case 'up':
			case 'k':
				this.move(0, -1);
				return;
			case 'down':
			case 'j':
				this.move(0, 1);
				return;
			case 'space':
			case 'return':
			case 'enter':
				this.primary();
				return;
			case 'p':
				this.switchTool('paint');
				return;
			case 'e':
				this.switchTool('erase');
				return;
			case 's':
				this.switchTool('stamp');
				return;
			case 'a':
				this.switchTool('anchor');
				return;
			case 'f':
				this.openPicker('fg');
				return;
			case 'g':
				this.openPicker('bg');
				return;
			case 'c':
				this.clearAtCursor();
				return;
			case 'w':
				this.doSave();
				return;
			case '[':
				this.stepFrame(-1);
				return;
			case ']':
				this.stepFrame(1);
				return;
			case 'q':
				this.onQuit?.();
				return;
		}
	}

	// ---- rendering ----

	protected renderSelf(buf: OptimizedBuffer): void {
		const W = buf.width;
		const H = buf.height;
		const viewH = Math.max(1, H - CHROME_H);
		const c = (q: RGBAQuad) => RGBA.fromInts(q[0], q[1], q[2], q[3]);
		const C = {
			bg: RGBA.fromInts(16, 18, 26, 255),
			grid: RGBA.fromInts(28, 32, 44, 255),
			chromeBg: RGBA.fromInts(22, 25, 34, 255),
			text: RGBA.fromInts(232, 232, 238, 255),
			dim: RGBA.fromInts(140, 148, 164, 255),
			feedback: RGBA.fromInts(255, 180, 80, 255),
			feedbackBg: RGBA.fromInts(60, 36, 20, 255),
			ok: RGBA.fromInts(140, 220, 150, 255),
			cursorBg: RGBA.fromInts(245, 215, 95, 255),
			cursorFg: RGBA.fromInts(20, 22, 30, 255),
			ink: RGBA.fromInts(232, 232, 238, 255),
			boxBg: RGBA.fromInts(30, 34, 48, 255),
			hot: RGBA.fromInts(245, 215, 95, 255),
		};

		buf.fillRect(0, 0, W, H, C.bg);

		const anchorFg = RGBA.fromInts(120, 230, 255, 255);
		const overrideFg = RGBA.fromInts(255, 210, 120, 255);
		const local = this.state.doc.colors;
		// The frame the canvas shows this instant (the edit frame, or the animated
		// frame during playback). cellAt only reads doc + frame name, so a shallow
		// state copy re-points it at the display frame without any mutation.
		const displayFrame = this.displayFrame;
		const viewState =
			displayFrame === this.state.frame
				? this.state
				: { ...this.state, frame: displayFrame };

		// The main (right-facing) canvas fills the left region; a mirror panel, when
		// toggled, takes the right region with a one-column divider between.
		const mainW = this.mirror ? Math.max(1, Math.floor((W - 1) / 2)) : W;

		// Keep the cursor's cell within the canvas viewport.
		const cursorCell = pixelToCell(this.state.cursor.x, this.state.cursor.y);
		const cam = scrollViewport(
			this.cam,
			{ x: cursorCell.cellX, y: cursorCell.cellY },
			mainW,
			viewH,
			SCROLLOFF,
		);
		this.cam = cam;

		for (let sy = 0; sy < viewH; sy++) {
			const cellY = cam.y + sy;
			for (let sx = 0; sx < mainW; sx++) {
				const cellX = cam.x + sx;
				const cell = cellAt(viewState, cellX, cellY);
				const fg = resolveColorKey(
					cell.fg,
					local,
					this.globalPalette,
					SPRITE_PREVIEWS,
				);
				const bg = resolveColorKey(
					cell.bg,
					local,
					this.globalPalette,
					SPRITE_PREVIEWS,
				);
				// Faint checkerboard on empty cells shows the 2×2 cell grid without
				// being mistaken for art.
				const checker = (cellX + cellY) % 2 === 0;
				const bgColor = bg ? c(bg) : checker ? C.grid : C.bg;
				if (cell.glyph === ' ') {
					buf.setCell(sx, sy, ' ', C.dim, bgColor);
				} else {
					buf.setCell(sx, sy, cell.glyph, fg ? c(fg) : C.ink, bgColor);
				}
			}
		}

		// Anchor markers overlay the art at their cells (frame overrides tinted
		// differently from doc-level anchors), so the artist sees where they land.
		for (const m of anchorMarkers(viewState)) {
			const sx = m.x - cam.x;
			const sy = m.y - cam.y;
			if (sx < 0 || sx >= mainW || sy < 0 || sy >= viewH) continue;
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? overrideFg : anchorFg,
				C.bg,
			);
		}

		// Cursor: highlight the cell and mark which quadrant the pixel sits on.
		const curSx = cursorCell.cellX - cam.x;
		const curSy = cursorCell.cellY - cam.y;
		if (curSx >= 0 && curSx < mainW && curSy >= 0 && curSy < viewH) {
			buf.setCell(
				curSx,
				curSy,
				quadrantMarker(cursorCell.bit),
				C.cursorFg,
				C.cursorBg,
			);
		}

		if (this.mirror) {
			this.renderMirror(buf, mainW, W, viewH, displayFrame, {
				c,
				grid: C.grid,
				bg: C.bg,
				ink: C.ink,
				dim: C.dim,
				anchorFg,
				overrideFg,
			});
		}

		// Chrome: status, feedback/save, help.
		const names = frameNames(this.state);
		const status = spriteStatusLine({
			id: this.spriteId,
			role: this.role,
			frame: this.state.frame,
			frameIdx: Math.max(0, names.indexOf(this.state.frame)),
			frameCount: names.length,
			tool: this.state.tool,
			fgKey: this.state.fgKey,
			bgKey: this.state.bgKey,
			cell: { x: cursorCell.cellX, y: cursorCell.cellY },
			bit: cursorCell.bit,
			dirty: this.dirty,
			pose: this.state.pose,
			anchorName: this.state.anchorName,
			anchorScope: this.state.anchorScope,
		});
		const statusRow = H - CHROME_H;
		buf.fillRect(0, statusRow, W, 1, C.chromeBg);
		buf.drawText(status.slice(0, W), 0, statusRow, C.text, C.chromeBg);

		const midRow = H - 2;
		buf.fillRect(0, midRow, W, 1, C.chromeBg);
		const hint = requiredHintLine(this.state.doc, this.role);
		if (this.playMode !== 'none') {
			const label =
				this.playMode === 'walk'
					? `▶ walk preview (${displayFrame}) — . or , stops`
					: `▶ playing ${this.state.pose} (${displayFrame}) — . or , stops`;
			buf.drawText(label.slice(0, W), 0, midRow, C.hot, C.chromeBg);
		} else if (this.awaitingStamp) {
			buf.drawText(
				'stamp: press a character to place (Esc cancels)'.slice(0, W),
				0,
				midRow,
				C.hot,
				C.chromeBg,
			);
		} else if (this.state.feedback) {
			buf.fillRect(0, midRow, W, 1, C.feedbackBg);
			buf.drawText(
				`⚠ ${this.state.feedback}`.slice(0, W),
				0,
				midRow,
				C.feedback,
				C.feedbackBg,
			);
		} else if (this.saved && this.saveDiags) {
			const summary = saveDiagSummary(
				this.saveDiags.map((d) => ({
					severity: d.severity,
					message: d.message,
				})),
			);
			const clean = this.saveDiags.length === 0;
			buf.drawText(
				summary.slice(0, W),
				0,
				midRow,
				clean ? C.ok : C.feedback,
				C.chromeBg,
			);
		} else if (hint) {
			// Non-blocking role-required-pose/anchor hint.
			buf.drawText(hint.slice(0, W), 0, midRow, C.dim, C.chromeBg);
		}

		const helpRow = H - 1;
		buf.fillRect(0, helpRow, W, 1, C.chromeBg);
		buf.drawText(spriteHelpLine().slice(0, W), 0, helpRow, C.dim, C.chromeBg);

		this.renderPicker(buf, W, H, C);
		this.renderPoseMenu(buf, W, H, C);
		this.renderAnchorMenu(buf, W, H, C);
	}

	// The read-only left-facing render of the current frame, drawn into the
	// right-hand region [mainW+1, W).
	private renderMirror(
		buf: OptimizedBuffer,
		mainW: number,
		W: number,
		viewH: number,
		frameName: string,
		// biome-ignore lint/suspicious/noExplicitAny: local color bag
		P: any,
	): void {
		const divider = mainW;
		const dividerColor = RGBA.fromInts(48, 54, 72, 255);
		for (let sy = 0; sy < viewH; sy++)
			buf.setCell(divider, sy, '│', dividerColor, P.bg);
		const ox = mainW + 1;
		const panelW = W - ox;
		if (panelW <= 0) return;

		const m = mirrorRender(this.state.doc, frameName);
		const local = this.state.doc.colors;
		for (let sy = 0; sy < viewH && sy < m.rows.length; sy++) {
			const row = m.rows[sy];
			const colorRow = m.colors[sy] ?? '';
			const bgRow = m.bg[sy] ?? '';
			for (let sx = 0; sx < panelW && sx < row.length; sx++) {
				const glyph = row[sx];
				if (glyph === ' ' || glyph === SENTINEL) {
					const checker = (sx + sy) % 2 === 0;
					buf.setCell(ox + sx, sy, ' ', P.dim, checker ? P.grid : P.bg);
					continue;
				}
				const fgKey = colorRow[sx] ?? '';
				const bgKey = bgRow[sx] ?? '';
				const fg = resolveColorKey(
					fgKey === SENTINEL ? this.state.doc.key : fgKey,
					local,
					this.globalPalette,
					SPRITE_PREVIEWS,
				);
				const bg = resolveColorKey(
					bgKey === SENTINEL ? '' : bgKey,
					local,
					this.globalPalette,
					SPRITE_PREVIEWS,
				);
				buf.setCell(
					ox + sx,
					sy,
					glyph,
					fg ? P.c(fg) : P.ink,
					bg ? P.c(bg) : P.bg,
				);
			}
		}
		// Mirrored anchor markers, reflected across the rendered width.
		for (const a of mirrorAnchorMarkers(anchorMarkers(this.state), m.width)) {
			if (a.x < 0 || a.x >= panelW || a.y < 0 || a.y >= viewH) continue;
			buf.setCell(
				ox + a.x,
				a.y,
				ANCHOR_MARKER,
				a.overridden ? P.overrideFg : P.anchorFg,
				P.bg,
			);
		}
	}

	private renderPicker(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		// biome-ignore lint/suspicious/noExplicitAny: local color bag
		C: any,
	): void {
		const p = this.picker;
		if (!p) return;
		const rows: string[] = [];
		if (p.form) {
			const f = p.form;
			const mark = (s: 'key' | 'r' | 'g' | 'b') => (f.stage === s ? '▸' : ' ');
			rows.push(`New file-local color (slot: ${p.slot})`);
			rows.push(`${mark('key')} key: ${f.key || '_'}`);
			rows.push(`${mark('r')} r: ${f.r || '_'}`);
			rows.push(`${mark('g')} g: ${f.g || '_'}`);
			rows.push(`${mark('b')} b: ${f.b || '_'}`);
			if (p.error) rows.push(`⚠ ${p.error}`);
			rows.push('Enter next · Esc back');
		} else {
			rows.push(`Pick ${p.slot} color`);
			for (let i = 0; i < p.options.length; i++) {
				const o = p.options[i];
				const label =
					o.kind === 'none'
						? 'none (transparent)'
						: o.kind === 'new'
							? '+ new file-local color'
							: `${o.entry.key}  ${o.entry.label}${o.entry.kind === 'dynamic' ? ' (dynamic)' : ''}`;
				rows.push(`${i === p.index ? '▸' : ' '} ${label}`);
			}
			rows.push('↑/↓ move · Enter pick · Esc close');
		}
		this.drawModal(buf, W, H, rows, C);
	}

	// A centered modal box from pre-formatted rows; a row beginning with '▸' is
	// highlighted. Shared by the picker and the pose/anchor menus.
	private drawModal(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		rows: string[],
		// biome-ignore lint/suspicious/noExplicitAny: local color bag
		C: any,
	): void {
		const boxW = Math.min(W, Math.max(20, ...rows.map((r) => r.length + 2)));
		const boxH = Math.min(H - 1, rows.length);
		const ox = Math.max(0, Math.floor((W - boxW) / 2));
		const oy = Math.max(0, Math.floor((H - boxH) / 2));
		for (let i = 0; i < boxH; i++) {
			buf.fillRect(ox, oy + i, boxW, 1, C.boxBg);
			const active = rows[i].startsWith('▸');
			buf.drawText(
				rows[i].slice(0, boxW),
				ox,
				oy + i,
				active ? C.hot : C.text,
				C.boxBg,
			);
		}
	}

	private renderPoseMenu(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		// biome-ignore lint/suspicious/noExplicitAny: local color bag
		C: any,
	): void {
		const menu = this.poseMenu;
		if (!menu) return;
		const rows: string[] = [];
		if (menu.input) {
			const title = menu.input.mode === 'create' ? 'New pose name' : 'Pose fps';
			rows.push(title);
			rows.push(`▸ ${menu.input.buffer || '_'}`);
			if (menu.error) rows.push(`⚠ ${menu.error}`);
			rows.push('Enter confirm · Esc back');
		} else {
			rows.push('Poses');
			for (let i = 0; i < menu.poses.length; i++) {
				const p = menu.poses[i];
				const fps = p.fps === null ? 'default' : `${p.fps}fps`;
				const sel = i === menu.index ? '▸' : ' ';
				const frameMark =
					i === menu.index && p.frameCount > 1
						? ` (frame ${menu.frameIndex + 1}/${p.frameCount})`
						: p.frameCount > 1
							? ` (${p.frameCount} frames)`
							: '';
				rows.push(`${sel} ${p.name} · ${fps}${frameMark}`);
			}
			if (menu.error) rows.push(`⚠ ${menu.error}`);
			rows.push('Enter switch · c new · d del · a +frame');
			rows.push('f fps · ←/→ pick frame · </> reorder · Esc');
		}
		this.drawModal(buf, W, H, rows, C);
	}

	private renderAnchorMenu(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		// biome-ignore lint/suspicious/noExplicitAny: local color bag
		C: any,
	): void {
		const menu = this.anchorMenu;
		if (!menu) return;
		const rows: string[] = [];
		if (menu.input) {
			rows.push('New anchor name');
			rows.push(`▸ ${menu.input.buffer || '_'}`);
			if (menu.error) rows.push(`⚠ ${menu.error}`);
			rows.push(`scope: ${menu.scope} · Enter confirm · Esc back`);
		} else {
			rows.push(`Place anchor (scope: ${menu.scope})`);
			for (let i = 0; i < menu.names.length; i++)
				rows.push(`${i === menu.index ? '▸' : ' '} ${menu.names[i]}`);
			const newSel = menu.index >= menu.names.length ? '▸' : ' ';
			rows.push(`${newSel} + new anchor`);
			rows.push('Enter pick · s toggle scope · Esc');
		}
		this.drawModal(buf, W, H, rows, C);
	}
}

// The `forge sprite edit <role>/<id>` entry point. Existing files parse and open
// (a null doc prints diagnostics and exits non-zero); a missing id with a role
// path opens a fresh template.
export async function runSpriteEdit(
	args: string[],
	deps: CliDeps,
): Promise<void> {
	const arg = args[0];
	const target = arg ? parseEditArg(arg) : undefined;
	if (!target) {
		deps.log('edit: missing <role>/<id> (e.g. forms/buddy)');
		process.exitCode = 1;
		return;
	}

	const path = arg ? findSpriteFile(deps.root, arg) : undefined;
	let doc: SpriteDoc;
	let role: SpriteRole;
	let savePath: string;
	let initialDiags: readonly SpriteDiagnostic[] = [];

	if (path) {
		const { readFileSync } = await import('node:fs');
		const text = readFileSync(path, 'utf8');
		const spriteId = basename(path).replace(/\.sprite$/, '');
		const parsed = parseSpriteFile(text, spriteId);
		initialDiags = parsed.diagnostics;
		if (!parsed.doc) {
			deps.log(formatSpriteDiagnostics(parsed.diagnostics));
			process.exitCode = 1;
			return;
		}
		doc = parsed.doc;
		savePath = path;
		role = roleForDir(basename(dirname(path))) ?? target.role ?? 'hat';
	} else {
		if (!target.role) {
			deps.log(
				`edit: no such sprite '${arg}' — pass a role path like forms/${target.id} to create it`,
			);
			process.exitCode = 1;
			return;
		}
		role = target.role;
		doc = emptySpriteDoc(target.id, role);
		savePath = join(deps.root, dirForRole(role), `${target.id}.sprite`);
	}

	const { createCliRenderer } = await import('@opentui/core');
	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
		useKittyKeyboard: {},
	});
	const doQuit = () => {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
		process.exit(0);
	};
	const editor = new SpriteEditor(renderer, {
		id: doc.id,
		role,
		doc,
		initialDiags,
		save: (text: string) => {
			mkdirSync(dirname(savePath), { recursive: true });
			writeFileSync(savePath, text);
		},
		onQuit: doQuit,
	});
	editor.attach(renderer.root);
	renderer.keyInput.on('keypress', (k: SpriteKey) => editor.key(k));
	// Drive animation playback: the editor advances its own presentation clock
	// each frame (a no-op while paused — the doc is never touched).
	renderer.setFrameCallback(async (dt: number) => editor.tick(dt));
	renderer.start();
}
