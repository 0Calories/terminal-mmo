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
	buildSceneStyle,
	type CellBuffer,
	parseSpriteFile,
	type RenderStyle,
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
import { renderComposite } from './composite';
import {
	applyInput,
	type KeyPaint,
	normalizeKey,
	normalizeMouse,
	type RawMouse,
} from './input';
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
	colorInk,
	createPose,
	defineLocalColor,
	deletePose,
	endStroke,
	frameNames,
	initSpriteEditor,
	inkLabel,
	moveCursor,
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
	setInk,
	setPoseFps,
	setTool,
	stampGlyph,
	TRANSPARENT_INK,
	undoEdit,
} from './state';
import { emptySpriteDoc, type SpriteRole } from './templates';
import {
	ANCHOR_MARKER,
	type Cam,
	composeStatusLine,
	DEFAULT_ZOOM,
	dirForRole,
	mirrorAnchorMarkers,
	mirrorRender,
	missingRequiredAnchors,
	parseEditArg,
	pixelToScreen,
	requiredHintLine,
	resolveColorKey,
	roleForDir,
	SPRITE_PREVIEWS,
	saveDiagSummary,
	screenToPixel,
	scrollAxis,
	spriteHelpLine,
	spriteStatusLine,
	stepZoom,
	visiblePixels,
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

// A mouse event as opentui's Renderable delivers it (a structural subset of
// `@opentui/core`'s MouseEvent — buttons: 0 left, 1 middle, 2 right).
export interface SpriteMouse {
	button: number;
	x: number;
	y: number;
	modifiers?: { shift?: boolean; alt?: boolean; ctrl?: boolean };
	scroll?: { direction: string };
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

// The box-drawing glyph for one cell of the cursor's z×z outline ring, or '' for
// an interior (non-edge) cell. All are unambiguous width-1 (unlike □/▫), so the
// ring never desyncs the terminal's mouse columns.
function cursorRingGlyph(dx: number, dy: number, z: number): string {
	const left = dx === 0;
	const right = dx === z - 1;
	const top = dy === 0;
	const bot = dy === z - 1;
	if (top && left) return '┌';
	if (top && right) return '┐';
	if (bot && left) return '└';
	if (bot && right) return '┘';
	if (top || bot) return '─';
	if (left || right) return '│';
	return '';
}

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

// Adapts a sub-rectangle of an opentui OptimizedBuffer to the shared renderer's
// `CellBuffer` so `renderComposite` (which clears + fills its whole buffer) can
// draw the Composited preview into just the right-hand panel.
class RegionBuffer implements CellBuffer<RGBA> {
	constructor(
		private readonly buf: OptimizedBuffer,
		private readonly ox: number,
		private readonly oy: number,
		readonly width: number,
		readonly height: number,
	) {}
	clear(bg: RGBA): void {
		this.buf.fillRect(this.ox, this.oy, this.width, this.height, bg);
	}
	setCell(x: number, y: number, ch: string, fg: RGBA, bg: RGBA): void {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
		this.buf.setCell(this.ox + x, this.oy + y, ch, fg, bg);
	}
	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: RGBA,
		bg: RGBA,
	): void {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
		this.buf.setCellWithAlphaBlending(this.ox + x, this.oy + y, ch, fg, bg);
	}
}

export class SpriteEditor extends Renderable {
	state: SpriteEditorState;
	picker: PickerState | null = null;
	poseMenu: PoseMenuState | null = null;
	anchorMenu: AnchorMenuState | null = null;
	mirror = false;
	// The in-context Composited preview panel (toggle: `o`) — the WIP art rendered
	// the way the game draws it, right beside the pixel canvas.
	composite = false;
	private readonly sceneStyle: RenderStyle<RGBA>;
	awaitingStamp = false;
	// Animation playback is presentation only — it never touches the doc/history.
	playMode: PlayMode = 'none';
	private playElapsedMs = 0;
	private penDown = false;
	// The fatbits zoom (×z on the ladder). Presentation only — never in the doc.
	zoom = DEFAULT_ZOOM;
	// The canvas camera in PIXEL coordinates (its top-left visible Pixel).
	private cam: Cam = { x: 0, y: 0 };
	// The canvas region's size in cells, captured each render so the mouse handler
	// can resolve screen→Pixel and reject clicks outside the canvas.
	private geom = { mainW: 0, viewH: 0 };
	// An in-flight mouse paint stroke (down→drag→up coalesces to one undo step),
	// and the button held for it (drag events don't reliably re-report the button).
	private mouseStroke = false;
	private mouseButton: RawMouse['button'] = 'left';
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
		this.sceneStyle = buildSceneStyle((r, g, b, a) =>
			RGBA.fromInts(r, g, b, a),
		);
		// Route the Renderable's pointer events into the pure paint seam: down/drag/
		// up bracket one coalescing pencil stroke.
		this.onMouseDown = (e) => this.mouseDown(e);
		this.onMouseDrag = (e) => this.mouseDrag(e);
		this.onMouseUp = () => this.mouseUp();
		this.onMouseDragEnd = () => this.mouseUp();
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
		// Enter the pure layer through the one normalized input event, exactly as a
		// mouse click will (spec #387): the eraser tool paints transparent ink, the
		// pencil paints the active ink.
		const paint: KeyPaint = this.state.tool === 'erase' ? 'transparent' : 'ink';
		this.state = applyInput(
			this.state,
			normalizeKey({ pixel: { x, y }, paint }),
		);
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

	// ---- zoom ----

	private setZoom(z: number): void {
		this.liftPen();
		this.zoom = z;
	}

	// ---- mouse ----

	// True while a modal (picker/menu/stamp-await) or playback owns input, so
	// canvas mouse gestures stay inert.
	private modalActive(): boolean {
		return (
			this.picker !== null ||
			this.poseMenu !== null ||
			this.anchorMenu !== null ||
			this.awaitingStamp ||
			this.playMode !== 'none'
		);
	}

	// The Pixel a screen cell resolves to through the fatbits geometry, or null
	// when the cell is outside the canvas region (a right-hand panel, the chrome).
	private canvasPixel(x: number, y: number): { x: number; y: number } | null {
		const { mainW, viewH } = this.geom;
		if (x < 0 || x >= mainW || y < 0 || y >= viewH) return null;
		return screenToPixel(x, y, this.cam, this.zoom);
	}

	// Feed a resolved mouse Pixel through the same normalized seam the keyboard
	// uses (left → active ink, right → transparent ink), so both devices paint
	// through one code path.
	private paintMouse(
		button: RawMouse['button'],
		px: { x: number; y: number },
		modifiers?: SpriteMouse['modifiers'],
	): void {
		const raw: RawMouse = {
			pixel: px,
			button,
			shift: modifiers?.shift,
			alt: modifiers?.alt,
			ctrl: modifiers?.ctrl,
		};
		this.state = applyInput(this.state, normalizeMouse(raw));
	}

	// Left/right press: the pencil (and its transparent eraser spelling) opens a
	// coalescing stroke and paints. Other tools take pointer input in later slices
	// (spec #387), so a click with them only moves the cursor here.
	mouseDown(e: SpriteMouse): void {
		if (this.modalActive()) return;
		const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'none';
		if (button === 'none') return;
		const px = this.canvasPixel(e.x, e.y);
		if (!px) return;
		if (this.state.tool !== 'paint' && this.state.tool !== 'erase') {
			this.state = moveCursor(this.state, px.x, px.y);
			return;
		}
		this.state = beginStroke(this.state);
		this.mouseStroke = true;
		this.mouseButton = button;
		this.paintMouse(button, px, e.modifiers);
	}

	mouseDrag(e: SpriteMouse): void {
		if (!this.mouseStroke) return;
		const px = this.canvasPixel(e.x, e.y);
		// A drag off the canvas edge simply paints nothing until it returns; the
		// held button is remembered from mouseDown since drag reports vary by term.
		if (!px) return;
		this.paintMouse(this.mouseButton, px, e.modifiers);
	}

	mouseUp(): void {
		if (this.mouseStroke) {
			this.state = endStroke(this.state);
			this.mouseStroke = false;
		}
	}

	// ---- picker ----

	private openPicker(): void {
		this.liftPen();
		this.picker = openPickerState(this.entries(), this.state.ink);
	}

	private applyPickerAction(action: PickerAction): void {
		switch (action.type) {
			case 'setInk':
				this.state = setInk(this.state, action.ink);
				break;
			case 'defineColor': {
				this.state = defineLocalColor(this.state, action.key, action.rgba);
				// Select the freshly defined color as the active ink.
				this.state = setInk(this.state, colorInk(action.key));
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
			if (k.name === 'o') {
				this.composite = !this.composite;
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
		if (k.name === 'o') {
			this.composite = !this.composite;
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
		// Zoom ladder: '+' (or '=') in, '-' out.
		if (k.sequence === '+' || k.sequence === '=') {
			this.setZoom(stepZoom(this.zoom, 1));
			return;
		}
		if (k.sequence === '-' || k.name === 'minus') {
			this.setZoom(stepZoom(this.zoom, -1));
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
				this.openPicker();
				return;
			case 't':
				this.liftPen();
				this.state = setInk(this.state, TRANSPARENT_INK);
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

		// The main (right-facing) canvas fills the left region; a right-hand panel,
		// when toggled, takes the right region with a one-column divider between.
		// The Composited preview (`o`) wins the panel over the mirror when both are on.
		const rightPanel = this.composite
			? 'composite'
			: this.mirror
				? 'mirror'
				: 'none';
		const mainW =
			rightPanel === 'none' ? W : Math.max(1, Math.floor((W - 1) / 2));
		this.geom = { mainW, viewH };

		// Fatbits camera: keep the cursor's PIXEL within the zoomed viewport. Each
		// Pixel occupies zoom×zoom cells, so the viewport spans this many Pixels.
		const z = this.zoom;
		const spanX = visiblePixels(mainW, z);
		const spanY = visiblePixels(viewH, z);
		const cam: Cam = {
			x: scrollAxis(this.cam.x, this.state.cursor.x, spanX, SCROLLOFF),
			y: scrollAxis(this.cam.y, this.state.cursor.y, spanY, SCROLLOFF),
		};
		this.cam = cam;

		// The background colour a Pixel magnifies to: a lit Pixel is its ink colour,
		// an opaque unlit Pixel shows its cell-wide background colour, and a
		// transparent Pixel is a per-cell checkerboard (spec #387). Shared by the
		// canvas fill and the cursor ring so the cursor never hides the colour it
		// sits on. `sx`/`sy` only pick the checkerboard phase (per terminal cell).
		const pixelBg = (px: number, py: number, sx: number, sy: number): RGBA => {
			const { cellX, cellY, bit } = pixelToCell(px, py);
			const cell = cellAt(viewState, cellX, cellY);
			const lit = cell.mask !== undefined && (cell.mask & (1 << bit)) !== 0;
			if (lit) {
				// A SENTINEL fg means "the frame's default key" (as the mirror does).
				const fgKey = cell.fg === SENTINEL ? this.state.doc.key : cell.fg;
				const fg = resolveColorKey(
					fgKey,
					local,
					this.globalPalette,
					SPRITE_PREVIEWS,
				);
				return fg ? c(fg) : C.ink;
			}
			const bgKey = cell.bg === SENTINEL ? '' : cell.bg;
			const bg =
				cell.mask === undefined
					? null
					: resolveColorKey(bgKey, local, this.globalPalette, SPRITE_PREVIEWS);
			if (bg) return c(bg);
			const checker = (cam.x * z + sx + (cam.y * z + sy)) % 2 === 0;
			return checker ? C.grid : C.bg;
		};

		// Draw every canvas cell as the z×z Pixel it magnifies. No half-blocks —
		// each Pixel owns its own square, so this is faithful magnification.
		for (let sy = 0; sy < viewH; sy++) {
			for (let sx = 0; sx < mainW; sx++) {
				const { x: px, y: py } = screenToPixel(sx, sy, cam, z);
				buf.setCell(sx, sy, ' ', C.dim, pixelBg(px, py, sx, sy));
			}
		}

		// Anchor markers overlay the art at the top-left cell of their (2×,2×) Pixel
		// block, so the artist sees where they land (overrides tinted apart).
		for (const m of anchorMarkers(viewState)) {
			const { x: sx, y: sy } = pixelToScreen(m.x * 2, m.y * 2, cam, z);
			if (sx < 0 || sx >= mainW || sy < 0 || sy >= viewH) continue;
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? overrideFg : anchorFg,
				C.bg,
			);
		}

		// Cursor: a bright ring on the active Pixel's z×z block, drawn with
		// box-drawing glyphs OVER the pixel's own colour (kept as the cell
		// background) so the pixel under the cursor stays legible. The glyphs are
		// unambiguous width-1 — an ambiguous-width marker (e.g. □) renders
		// double-wide in some terminals and desyncs every mouse column to its right.
		// At ×1 the single cell is reverse-highlighted instead (no room for a ring).
		const cb = pixelToScreen(this.state.cursor.x, this.state.cursor.y, cam, z);
		if (z === 1) {
			if (cb.x >= 0 && cb.x < mainW && cb.y >= 0 && cb.y < viewH)
				buf.setCell(cb.x, cb.y, ' ', C.cursorFg, C.cursorBg);
		} else {
			for (let dy = 0; dy < z; dy++) {
				for (let dx = 0; dx < z; dx++) {
					const glyph = cursorRingGlyph(dx, dy, z);
					if (!glyph) continue;
					const sx = cb.x + dx;
					const sy = cb.y + dy;
					if (sx < 0 || sx >= mainW || sy < 0 || sy >= viewH) continue;
					const under = pixelBg(
						this.state.cursor.x,
						this.state.cursor.y,
						sx,
						sy,
					);
					buf.setCell(sx, sy, glyph, C.cursorBg, under);
				}
			}
		}

		if (rightPanel === 'mirror') {
			this.renderMirror(buf, mainW, W, viewH, displayFrame, {
				c,
				grid: C.grid,
				bg: C.bg,
				ink: C.ink,
				dim: C.dim,
				anchorFg,
				overrideFg,
			});
		} else if (rightPanel === 'composite') {
			this.renderComposite(buf, mainW, W, viewH, displayFrame, C.dim, C.bg);
		}

		// Chrome: status (with the coercion feedback right-aligned on it), then a
		// mid row for save diagnostics / hints / playback, then the help line.
		const names = frameNames(this.state);
		const cursorCell = pixelToCell(this.state.cursor.x, this.state.cursor.y);
		const statusLeft = spriteStatusLine({
			id: this.spriteId,
			role: this.role,
			frame: this.state.frame,
			frameIdx: Math.max(0, names.indexOf(this.state.frame)),
			frameCount: names.length,
			tool: this.state.tool,
			ink: inkLabel(this.state.ink),
			pixel: { x: this.state.cursor.x, y: this.state.cursor.y },
			cell: { x: cursorCell.cellX, y: cursorCell.cellY },
			bit: cursorCell.bit,
			zoom: this.zoom,
			dirty: this.dirty,
			pose: this.state.pose,
			anchorName: this.state.anchorName,
			anchorScope: this.state.anchorScope,
		});
		// The coercion note rides the right of the status row (out of the mid row's
		// save/hint/playback channel). Draw the composed line, then re-tint just the
		// note when it made the cut so it stands out.
		const feedback = this.state.feedback;
		const status = composeStatusLine(statusLeft, feedback, W);
		const statusRow = H - CHROME_H;
		buf.fillRect(0, statusRow, W, 1, C.chromeBg);
		buf.drawText(status, 0, statusRow, C.text, C.chromeBg);
		if (feedback && status.endsWith(feedback)) {
			const rx = status.length - feedback.length;
			buf.drawText(feedback, rx, statusRow, C.feedback, C.chromeBg);
		}

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

	// The in-context Composited preview drawn into the right-hand region, through
	// the shared renderer (`renderComposite`) — pixel-identical to the game. Shows
	// the CURRENT display frame: a hat on a body, a weapon in hand at its phase, a
	// form wearing a hat + weapon, or a monster/npc plain. Animates during playback
	// because `frameName` (the editor's display frame) advances with each tick.
	private renderComposite(
		buf: OptimizedBuffer,
		mainW: number,
		W: number,
		viewH: number,
		frameName: string,
		dim: RGBA,
		bg: RGBA,
	): void {
		const divider = mainW;
		const dividerColor = RGBA.fromInts(48, 54, 72, 255);
		for (let sy = 0; sy < viewH; sy++)
			buf.setCell(divider, sy, '│', dividerColor, bg);
		const ox = mainW + 1;
		const panelW = W - ox;
		if (panelW <= 0) return;

		const region = new RegionBuffer(buf, ox, 0, panelW, viewH);
		const ok = renderComposite(
			region,
			this.state.doc,
			this.role,
			this.sceneStyle,
			{
				facing: this.mirror ? -1 : 1,
				// The display frame is a concrete frame name; the composite maps it to
				// the role-appropriate composition (weapon frame → swing phase, etc.).
				stance: frameName,
				elapsedS: 0,
			},
		);
		if (!ok) {
			const msg = 'keep drawing…';
			buf.drawText(msg.slice(0, panelW), ox, 0, dim, bg);
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
			rows.push('New file-local color');
			rows.push(`${mark('key')} key: ${f.key || '_'}`);
			rows.push(`${mark('r')} r: ${f.r || '_'}`);
			rows.push(`${mark('g')} g: ${f.g || '_'}`);
			rows.push(`${mark('b')} b: ${f.b || '_'}`);
			if (p.error) rows.push(`⚠ ${p.error}`);
			rows.push('Enter next · Esc back');
		} else {
			rows.push('Pick ink');
			for (let i = 0; i < p.options.length; i++) {
				const o = p.options[i];
				const label =
					o.kind === 'transparent'
						? 'transparent'
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
