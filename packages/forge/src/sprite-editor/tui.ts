// The `@opentui/core` glue for the Sprite editor (ADR 0031): a single Renderable
// that draws the pure editor state and a `key()` dispatcher that mutates it
// through the pure ops in `state.ts`. All logic lives in the pure modules
// (`state.ts`, `chrome.ts`, `strips.ts`, `picker.ts`, `view.ts`); this file only
// wires them to the screen buffer, keyboard and mouse, mirroring the zone
// editor's `editor.ts` structure. The Renderable is exported so the TUI can be
// smoke-tested headlessly with `@opentui/core/testing`.
//
// Layout (spec #387, locked by prototype #375): a 30-column left rail (tools ·
// ink · playback), the canvas region beside it in one of two views — STRIPS
// (default; every Pose a labeled strip of editable Frames) and FOCUS (`tab`;
// one Frame centred under a Frame-name tab row) — and a two-row bottom chrome:
// the status line (coercion feedback right-aligned) over a context-sensitive
// hint line. `?` opens the complete grouped key map.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RGBAQuad } from '@mmo/core/entities';
import { SCENE_PALETTE } from '@mmo/core/entities';
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
import {
	helpOverlayRows,
	hintLine,
	RAIL_TOOLS,
	RAIL_W,
	type RailAction,
	type RailRow,
	railActionAt,
	railModel,
} from './chrome';
import { renderComposite } from './composite';
import {
	applyInput,
	type KeyPaint,
	normalizeKey,
	normalizeMouse,
	type RawMouse,
	routeWheel,
	type WheelDirection,
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
import { cycleOnionDepth, ghostColor, onionGhosts } from './onion';
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
	currentFrame,
	defineLocalColor,
	deletePose,
	endStroke,
	frameExtent,
	frameNames,
	initSpriteEditor,
	inkLabel,
	moveCursor,
	paletteEntries,
	pixelToCell,
	placeAnchor,
	poseFrames,
	poseNames,
	readPixel,
	redoEdit,
	removeAnchorOverride,
	reorderFrame,
	type SpriteEditorState,
	type SpriteTool,
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
import {
	centeredOrigin,
	clampScroll,
	type FocusTab,
	focusTabAt,
	focusTabs,
	frameBoxOf,
	type StripsLayout,
	scrollIntoView,
	stripsHit,
	stripsLayout,
} from './strips';
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
	requiredHintLine,
	resolveColorKey,
	roleForDir,
	SPRITE_PREVIEWS,
	saveDiagSummary,
	scrollAxis,
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

// Two chrome rows: the status line and the hint line under it (spec #387).
const CHROME_H = 2;
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

// The two canvas views (spec #387): strips is the default; `tab` toggles.
type CanvasView = 'strips' | 'focus';

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

// The colour bag renderSelf builds each frame and hands to the draw helpers.
interface Palette {
	bg: RGBA;
	grid: RGBA;
	chromeBg: RGBA;
	text: RGBA;
	dim: RGBA;
	feedback: RGBA;
	ok: RGBA;
	cursorBg: RGBA;
	cursorFg: RGBA;
	ink: RGBA;
	boxBg: RGBA;
	hot: RGBA;
	divider: RGBA;
	anchorFg: RGBA;
	overrideFg: RGBA;
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
	// Which canvas view is active: strips (default) or focus (`tab`).
	view: CanvasView = 'strips';
	// Whether the `?` key-map overlay is open.
	helpOpen = false;
	private readonly sceneStyle: RenderStyle<RGBA>;
	awaitingStamp = false;
	// Animation playback is presentation only — it never touches the doc/history.
	playMode: PlayMode = 'none';
	private playElapsedMs = 0;
	private penDown = false;
	// The fatbits zoom (×z on the ladder). Presentation only — never in the doc.
	zoom = DEFAULT_ZOOM;
	// Onion-skin depth (0 off, cycled by `O`). Presentation only. Ghosts are drawn
	// only for the active Frame, and only while not playing (playback suspends
	// them). `onionLayers` is the per-render, pre-pointed source built from it.
	onionDepth = 0;
	private onionLayers: {
		read: (px: number, py: number) => boolean;
		color: RGBA;
	}[] = [];
	// Focus-view camera in PIXEL coordinates (its top-left visible Pixel).
	private cam: Cam = { x: 0, y: 0 };
	// Strips-view scroll in screen cells over the layout's content coordinates.
	private scroll = { x: 0, y: 0 };
	// While true the render keeps the cursor in view (cursor-driven navigation);
	// a wheel or pan gesture takes over the viewport and clears it.
	private followCursor = true;
	// An in-flight middle-drag pan: the last mouse cell it was seen at, plus the
	// leftover screen cells (short of a whole Pixel at the current zoom) the
	// focus view accumulates between camera steps.
	private panLast: { x: number; y: number } | null = null;
	private panRem = { x: 0, y: 0 };
	// The geometry of the last render, captured so the mouse handlers can invert
	// screen cells back to rail rows / Frames / Pixels.
	private geom: {
		viewH: number;
		// Width of the canvas view sub-region (left of any mirror/composite panel).
		viewW: number;
		rail: readonly RailRow[];
		layout: StripsLayout | null;
		focus: {
			tabs: readonly FocusTab[];
			origin: { x: number; y: number };
			top: number;
		} | null;
	} = { viewH: 0, viewW: 0, rail: [], layout: null, focus: null };
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
		// Route the Renderable's pointer events into the pure input seam: down/
		// drag/up bracket one coalescing pencil stroke or a middle-drag pan, and
		// bare scroll events carry the wheel.
		this.onMouseDown = (e) => this.mouseDown(e);
		this.onMouseDrag = (e) => this.mouseDrag(e);
		this.onMouseUp = (e) => this.mouseUp(e);
		this.onMouseDragEnd = (e) => this.mouseUp(e);
		this.onMouse = (e) => {
			if (e.type === 'scroll' && e.scroll) this.wheel(e as SpriteMouse);
		};
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
		this.followCursor = true;
		if (this.penDown) this.applyAtCursor();
	}

	// ---- zoom ----

	private setZoom(z: number): void {
		this.liftPen();
		this.zoom = z;
	}

	// ---- mouse ----

	// True while a modal (picker/menu/stamp-await/help) or playback owns input,
	// so canvas mouse gestures stay inert.
	private modalActive(): boolean {
		return (
			this.picker !== null ||
			this.poseMenu !== null ||
			this.anchorMenu !== null ||
			this.awaitingStamp ||
			this.helpOpen ||
			this.playMode !== 'none'
		);
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

	private applyRail(action: RailAction): void {
		switch (action.type) {
			case 'tool':
				this.switchTool(action.tool);
				return;
			case 'ink':
				this.liftPen();
				this.state = setInk(this.state, action.ink);
				return;
			case 'pickInk':
				this.openPicker();
				return;
			case 'play':
				this.togglePlay(action.mode);
				return;
			case 'addFrame':
				this.addFrame();
				return;
			case 'poseMenu':
				this.openPoseMenu();
				return;
			case 'anchorMenu':
				this.openAnchorMenu();
				return;
		}
	}

	// A screen cell in the strips view's content coordinates (the unscrolled
	// grid stripsLayout lays out).
	private stripsContentAt(e: { x: number; y: number }): {
		cx: number;
		cy: number;
	} {
		return { cx: e.x - RAIL_W + this.scroll.x, cy: e.y + this.scroll.y };
	}

	// Move the strips scroll by a delta, clamped to the layout's content.
	private scrollStripsBy(dx: number, dy: number): void {
		const layout = this.geom.layout;
		if (!layout) return;
		this.scroll.x = clampScroll(
			this.scroll.x + dx,
			layout.contentW,
			this.geom.viewW,
		);
		this.scroll.y = clampScroll(
			this.scroll.y + dy,
			layout.contentH,
			this.geom.viewH,
		);
	}

	// Dismiss the post-save summary on the hint line: any further input means
	// the artist has moved on.
	private dismissSaveNotice(): void {
		this.saved = false;
	}

	// The Pixel a canvas cell resolves to in the focus view (may be negative /
	// past the frame; the pure layer clips), or null outside the canvas region.
	private focusPixel(x: number, y: number): { x: number; y: number } | null {
		const f = this.geom.focus;
		if (!f) return null;
		const { viewH, viewW } = this.geom;
		if (x < RAIL_W || x >= RAIL_W + viewW || y < f.top || y >= viewH)
			return null;
		const z = this.zoom;
		return {
			x: this.cam.x + Math.floor((x - f.origin.x) / z),
			y: this.cam.y + Math.floor((y - f.origin.y) / z),
		};
	}

	// A left/right press on the canvas region: resolve the Frame + Pixel under
	// the pointer (activating the Frame click-through in strips / on a focus
	// tab), then open a coalescing stroke for the paint tools.
	private canvasDown(button: 'left' | 'right', e: SpriteMouse): void {
		let px: { x: number; y: number } | null = null;
		if (this.view === 'strips') {
			const layout = this.geom.layout;
			if (!layout) return;
			const { cx, cy } = this.stripsContentAt(e);
			const hit = stripsHit(layout, cx, cy);
			if (!hit) {
				// A click on a strip's name row activates that Frame without painting.
				const strip = layout.nameRows.indexOf(cy);
				if (strip >= 0) {
					const pose = layout.labels[strip].pose;
					const box = layout.frames.find(
						(f) => f.pose === pose && cx >= f.x && cx < f.x + f.w,
					);
					if (box) this.state = selectFrame(this.state, box.name);
				}
				return;
			}
			// Click-through activation: the click both activates the Frame and lands
			// as the tool's application at the resolved Pixel (spec #387).
			if (hit.frame.name !== this.state.frame)
				this.state = selectFrame(this.state, hit.frame.name);
			px = { x: hit.px, y: hit.py };
		} else {
			const f = this.geom.focus;
			if (f && e.y < f.top) {
				const tab = focusTabAt(f.tabs, e.x - RAIL_W);
				if (tab) this.state = selectFrame(this.state, tab.name);
				return;
			}
			px = this.focusPixel(e.x, e.y);
		}
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

	mouseDown(e: SpriteMouse): void {
		this.dismissSaveNotice();
		if (this.helpOpen) {
			this.helpOpen = false;
			return;
		}
		if (this.modalActive()) return;
		// Middle button starts a pan (spec #387) in either view.
		if (e.button === 1) {
			this.panLast = { x: e.x, y: e.y };
			return;
		}
		const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'none';
		if (button === 'none') return;
		if (e.y >= this.geom.viewH) return; // the chrome rows
		if (e.x < RAIL_W) {
			const action = railActionAt(this.geom.rail, e.x, e.y);
			if (action) this.applyRail(action);
			return;
		}
		this.canvasDown(button, e);
	}

	mouseDrag(e: SpriteMouse): void {
		if (this.panLast) {
			this.pan(e.x - this.panLast.x, e.y - this.panLast.y);
			this.panLast = { x: e.x, y: e.y };
			return;
		}
		if (!this.mouseStroke) return;
		// A drag off the canvas simply paints nothing until it returns; the held
		// button is remembered from mouseDown since drag reports vary by terminal.
		let px: { x: number; y: number } | null = null;
		if (this.view === 'strips') {
			const layout = this.geom.layout;
			if (!layout) return;
			const { cx, cy } = this.stripsContentAt(e);
			const hit = stripsHit(layout, cx, cy);
			// A stroke stays in the Frame it started on — dragging across a
			// neighbouring Frame's block must not silently switch and paint there.
			if (!hit || hit.frame.name !== this.state.frame) return;
			px = { x: hit.px, y: hit.py };
		} else {
			px = this.focusPixel(e.x, e.y);
		}
		if (!px) return;
		this.paintMouse(this.mouseButton, px, e.modifiers);
	}

	mouseUp(_e?: unknown): void {
		this.panLast = null;
		if (this.mouseStroke) {
			this.state = endStroke(this.state);
			this.mouseStroke = false;
		}
	}

	// Middle-drag pan: the content follows the pointer. Strips scroll in screen
	// cells; the focus camera moves in whole Pixels, accumulating the sub-Pixel
	// remainder so slow drags still pan at high zoom.
	private pan(dx: number, dy: number): void {
		this.followCursor = false;
		if (this.view === 'strips') {
			this.scrollStripsBy(-dx, -dy);
			return;
		}
		const z = this.zoom;
		this.panRem.x += dx;
		this.panRem.y += dy;
		const px = Math.trunc(this.panRem.x / z);
		const py = Math.trunc(this.panRem.y / z);
		this.panRem.x -= px * z;
		this.panRem.y -= py * z;
		this.cam = {
			x: Math.max(0, this.cam.x - px),
			y: Math.max(0, this.cam.y - py),
		};
	}

	// Wheel routing (spec #387): wheel scrolls, shift-wheel scrolls horizontally,
	// ctrl-wheel zooms — in both views.
	wheel(e: SpriteMouse): void {
		if (this.modalActive() || !e.scroll) return;
		const route = routeWheel(e.scroll.direction as WheelDirection, {
			shift: e.modifiers?.shift ?? false,
			alt: e.modifiers?.alt ?? false,
			ctrl: e.modifiers?.ctrl ?? false,
		});
		if (route.kind === 'zoom') {
			this.setZoom(stepZoom(this.zoom, route.dir));
			return;
		}
		this.followCursor = false;
		if (this.view === 'strips') {
			this.scrollStripsBy(route.dx, route.dy);
			return;
		}
		// Focus view scrolls its Pixel camera; a wheel notch is ~one Pixel row at
		// high zoom, more when zoomed out.
		const z = this.zoom;
		const step = (d: number) =>
			d === 0 ? 0 : Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / z));
		this.cam = {
			x: Math.max(0, this.cam.x + step(route.dx)),
			y: Math.max(0, this.cam.y + step(route.dy)),
		};
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

	// ---- frames / poses / edits ----

	private stepFrame(delta: number): void {
		this.liftPen();
		const names = frameNames(this.state);
		const i = names.indexOf(this.state.frame);
		const next = names[(i + delta + names.length) % names.length];
		if (next) this.state = selectFrame(this.state, next);
		this.followCursor = true;
	}

	private stepPose(delta: number): void {
		this.liftPen();
		const names = poseNames(this.state);
		if (names.length === 0) return;
		const i = Math.max(0, names.indexOf(this.state.pose));
		const next = names[(i + delta + names.length) % names.length];
		this.state = selectPose(this.state, next);
		this.followCursor = true;
	}

	private addFrame(): void {
		this.liftPen();
		this.state = addFrameToPose(this.state, this.state.pose);
		this.followCursor = true;
	}

	private toggleView(): void {
		this.liftPen();
		this.view = this.view === 'strips' ? 'focus' : 'strips';
		this.followCursor = true;
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

	private switchTool(tool: SpriteTool): void {
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

	// Cycle the onion-skin depth 0 → 1 → 2 → 0 (spec #387). Presentation only.
	private cycleOnion(): void {
		this.onionDepth = cycleOnionDepth(this.onionDepth);
		const label =
			this.onionDepth === 0
				? 'onion skin off'
				: `onion skin depth ${this.onionDepth}`;
		this.state = { ...this.state, feedback: label };
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
		if (this.helpOpen) {
			if (k.sequence === '?' || k.name === 'escape' || k.name === 'q')
				this.helpOpen = false;
			return;
		}
		this.dismissSaveNotice();
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
		if (k.sequence === '?') {
			this.liftPen();
			this.helpOpen = true;
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
			if (k.name === 'v') {
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
		if (k.name === 'v') {
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
		if (k.sequence === 'O') {
			this.cycleOnion();
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
		// Pose stepping and the strips ↔ focus toggle.
		if (k.sequence === '{') {
			this.stepPose(-1);
			return;
		}
		if (k.sequence === '}') {
			this.stepPose(1);
			return;
		}
		if (k.name === 'tab') {
			this.toggleView();
			return;
		}
		// Tools also live on the number row, in rail order (spec #387).
		const railTool = RAIL_TOOLS.find((t) => k.sequence === t.key);
		if (railTool) {
			this.switchTool(railTool.tool);
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
			case 'n':
				this.addFrame();
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

	private static rgba(q: RGBAQuad): RGBA {
		return RGBA.fromInts(q[0], q[1], q[2], q[3]);
	}

	// Rebuild the onion-skin ghost layers for this render: one pre-pointed reader +
	// tint per neighbouring Frame the active Pose sources at the current depth,
	// nearest first. Empty while playing (playback suspends ghosts, spec #387) or
	// when onion is off, so `onionGhostRGBA` is a cheap no-op then.
	private buildOnionLayers(C: Palette): void {
		if (this.playMode !== 'none' || this.onionDepth <= 0) {
			this.onionLayers = [];
			return;
		}
		const frames = poseFrames(this.state, this.state.pose);
		const ghosts = onionGhosts(frames, this.state.frame, this.onionDepth);
		const bg = C.bg.toInts();
		this.onionLayers = ghosts.map((g) => {
			const ghostState: SpriteEditorState = { ...this.state, frame: g.frame };
			return {
				read: (px: number, py: number) => readPixel(ghostState, px, py),
				color: SpriteEditor.rgba(ghostColor(g.tint, g.intensity, bg)),
			};
		});
	}

	// The ghost colour showing through a transparent Pixel of the active Frame, or
	// null when no ghost lights it. The first (nearest) lit layer wins, so nearest
	// Frames read strongest and prev (red) beats next (blue) at equal distance.
	private onionGhostRGBA(px: number, py: number): RGBA | null {
		for (const layer of this.onionLayers)
			if (layer.read(px, py)) return layer.color;
		return null;
	}

	// The background colour a Pixel magnifies to: a lit Pixel is its ink colour,
	// an opaque unlit Pixel shows its cell-wide background colour, and a
	// transparent Pixel is a per-cell checkerboard (spec #387) — or, when `onion`
	// is set (the active Frame, not playing), an onion ghost showing UNDER the art
	// through that transparency, replacing the checkerboard where a ghost lights
	// it. `phase` picks the checkerboard shade (it alternates per art cell).
	private pixelRGBA(
		st: SpriteEditorState,
		px: number,
		py: number,
		phase: number,
		C: Palette,
		onion = false,
	): RGBA {
		const local = this.state.doc.colors;
		const { cellX, cellY, bit } = pixelToCell(px, py);
		const cell = cellAt(st, cellX, cellY);
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
			return fg ? SpriteEditor.rgba(fg) : C.ink;
		}
		const bgKey = cell.bg === SENTINEL ? '' : cell.bg;
		const bg =
			cell.mask === undefined
				? null
				: resolveColorKey(bgKey, local, this.globalPalette, SPRITE_PREVIEWS);
		if (bg) return SpriteEditor.rgba(bg);
		// Transparent Pixel: an onion ghost shows through it under the art (active
		// Frame only), else the checkerboard.
		if (onion) {
			const ghost = this.onionGhostRGBA(px, py);
			if (ghost) return ghost;
		}
		return phase % 2 === 0 ? C.grid : C.bg;
	}

	// Draw a piece of text at `sx`, clipped to the column range [x0, x1).
	private drawClipped(
		buf: OptimizedBuffer,
		text: string,
		sx: number,
		sy: number,
		x0: number,
		x1: number,
		fg: RGBA,
		bg: RGBA,
	): void {
		let s = text;
		let x = sx;
		if (x < x0) {
			s = s.slice(x0 - x);
			x = x0;
		}
		if (x + s.length > x1) s = s.slice(0, Math.max(0, x1 - x));
		if (s) buf.drawText(s, x, sy, fg, bg);
	}

	// The cursor ring on the active Pixel's z×z block, drawn with box-drawing
	// glyphs OVER the pixel's own colour (kept as the cell background) so the
	// pixel under the cursor stays legible. The glyphs are unambiguous width-1 —
	// an ambiguous-width marker (e.g. □) renders double-wide in some terminals
	// and desyncs every mouse column to its right. At ×1 the single cell is
	// reverse-highlighted instead (no room for a ring).
	private drawCursorRing(
		buf: OptimizedBuffer,
		bx: number,
		by: number,
		clip: { x0: number; x1: number; y0: number; y1: number },
		under: (sx: number, sy: number) => RGBA,
		C: Palette,
	): void {
		const z = this.zoom;
		const inside = (sx: number, sy: number) =>
			sx >= clip.x0 && sx < clip.x1 && sy >= clip.y0 && sy < clip.y1;
		if (z === 1) {
			if (inside(bx, by)) buf.setCell(bx, by, ' ', C.cursorFg, C.cursorBg);
			return;
		}
		for (let dy = 0; dy < z; dy++) {
			for (let dx = 0; dx < z; dx++) {
				const glyph = cursorRingGlyph(dx, dy, z);
				if (!glyph) continue;
				const sx = bx + dx;
				const sy = by + dy;
				if (!inside(sx, sy)) continue;
				buf.setCell(sx, sy, glyph, C.cursorBg, under(sx, sy));
			}
		}
	}

	// The 30-column left rail: tools · ink · playback, with a divider column.
	private renderRail(buf: OptimizedBuffer, viewH: number, C: Palette): void {
		buf.fillRect(0, 0, RAIL_W - 1, viewH, C.chromeBg);
		for (let y = 0; y < viewH; y++)
			buf.setCell(RAIL_W - 1, y, '│', C.divider, C.bg);
		const rows = railModel({
			tool: this.state.tool,
			ink: this.state.ink,
			entries: this.entries(),
			pose: this.state.pose,
			fps: poseFps(this.state.doc.fps, this.state.pose),
			frameCount: poseFrames(this.state, this.state.pose).length,
			playMode: this.playMode,
			onionDepth: this.onionDepth,
			height: viewH,
		});
		this.geom.rail = rows;
		rows.slice(0, viewH).forEach((row, y) => {
			let x = 0;
			for (const span of row.spans) {
				if (x >= RAIL_W - 1) break;
				const text = span.text.slice(0, RAIL_W - 1 - x);
				if (span.swatch === 'checker') {
					buf.drawText(text, x, y, C.dim, C.chromeBg);
				} else if (span.swatch) {
					buf.drawText(text, x, y, C.text, SpriteEditor.rgba(span.swatch));
				} else {
					const fg = span.hot ? C.hot : span.dim ? C.dim : C.text;
					buf.drawText(text, x, y, fg, C.chromeBg);
				}
				x += span.text.length;
			}
		});
	}

	// STRIPS: every Pose a labeled horizontal strip of its Frames, all editable
	// in place, the active Frame underlined (spec #387).
	private renderStrips(
		buf: OptimizedBuffer,
		viewW: number,
		viewH: number,
		C: Palette,
	): void {
		const z = this.zoom;
		const layout = stripsLayout(this.state.doc, z);
		this.geom.layout = layout;
		this.geom.focus = null;
		const x0 = RAIL_W;
		const x1 = RAIL_W + viewW;

		// Cursor-driven navigation keeps the cursor's Pixel block (and the strip
		// label above it) in view; wheel/pan own the viewport otherwise.
		if (this.followCursor) {
			const box = frameBoxOf(layout, this.state.frame);
			if (box) {
				const bx = box.x + this.state.cursor.x * z;
				const by = box.y + this.state.cursor.y * z;
				this.scroll.x = scrollIntoView(this.scroll.x, bx, bx + z, viewW);
				this.scroll.y = scrollIntoView(this.scroll.y, by - 1, by + z, viewH);
			}
		}
		this.scroll.x = clampScroll(this.scroll.x, layout.contentW, viewW);
		this.scroll.y = clampScroll(this.scroll.y, layout.contentH, viewH);
		const sxOf = (cx: number) => x0 + cx - this.scroll.x;
		const syOf = (cy: number) => cy - this.scroll.y;

		for (const label of layout.labels) {
			const sy = syOf(label.y);
			if (sy < 0 || sy >= viewH) continue;
			this.drawClipped(buf, label.text, sxOf(0), sy, x0, x1, C.dim, C.bg);
		}

		for (const box of layout.frames) {
			const active = box.name === this.state.frame;
			const st = active ? this.state : { ...this.state, frame: box.name };
			const cy0 = Math.max(box.y, this.scroll.y);
			const cy1 = Math.min(box.y + box.h, this.scroll.y + viewH);
			const cx0 = Math.max(box.x, this.scroll.x);
			const cx1 = Math.min(box.x + box.w, this.scroll.x + viewW);
			for (let cy = cy0; cy < cy1; cy++) {
				for (let cx = cx0; cx < cx1; cx++) {
					const px = Math.floor((cx - box.x) / z);
					const py = Math.floor((cy - box.y) / z);
					buf.setCell(
						sxOf(cx),
						syOf(cy),
						' ',
						C.dim,
						this.pixelRGBA(st, px, py, cx + cy, C, active),
					);
				}
			}
		}

		// Frame-name rows: the active Frame's name is highlighted and its block
		// width underlined.
		layout.labels.forEach((label, i) => {
			const sy = syOf(layout.nameRows[i]);
			if (sy < 0 || sy >= viewH) return;
			for (const box of layout.frames) {
				if (box.pose !== label.pose) continue;
				const active = box.name === this.state.frame;
				const text = active
					? (box.name + '▔'.repeat(Math.max(0, box.w - box.name.length))).slice(
							0,
							Math.max(box.w, box.name.length),
						)
					: box.name;
				this.drawClipped(
					buf,
					text,
					sxOf(box.x),
					sy,
					x0,
					x1,
					active ? C.hot : C.dim,
					C.bg,
				);
			}
		});

		const activeBox = frameBoxOf(layout, this.state.frame);
		if (!activeBox) return;

		// Anchor markers overlay the ACTIVE Frame's art at the top-left cell of
		// their (2×,2×) Pixel block (overrides tinted apart).
		for (const m of anchorMarkers(this.state)) {
			const sx = sxOf(activeBox.x + m.x * 2 * z);
			const sy = syOf(activeBox.y + m.y * 2 * z);
			if (sx < x0 || sx >= x1 || sy < 0 || sy >= viewH) continue;
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? C.overrideFg : C.anchorFg,
				C.bg,
			);
		}

		const bx = sxOf(activeBox.x + this.state.cursor.x * z);
		const by = syOf(activeBox.y + this.state.cursor.y * z);
		this.drawCursorRing(
			buf,
			bx,
			by,
			{ x0, x1, y0: 0, y1: viewH },
			(sx, sy) =>
				this.pixelRGBA(
					this.state,
					this.state.cursor.x,
					this.state.cursor.y,
					sx - x0 + this.scroll.x + (sy + this.scroll.y),
					C,
					true,
				),
			C,
		);
	}

	// FOCUS: one Frame centred (camera-scrolled when it doesn't fit) under a
	// Frame-name tab row. Playback reuses this canvas with the tabs hidden.
	private renderFocus(
		buf: OptimizedBuffer,
		viewW: number,
		viewH: number,
		viewState: SpriteEditorState,
		showTabs: boolean,
		C: Palette,
	): void {
		const z = this.zoom;
		this.geom.layout = null;
		let top = 0;
		let tabs: readonly FocusTab[] = [];
		if (showTabs) {
			const frames = poseFrames(this.state, this.state.pose);
			const list = frames.length > 0 ? frames : frameNames(this.state);
			const ft = focusTabs(list, this.state.frame);
			tabs = ft.tabs;
			buf.fillRect(RAIL_W, 0, viewW, 1, C.chromeBg);
			this.drawClipped(
				buf,
				ft.text,
				RAIL_W,
				0,
				RAIL_W,
				RAIL_W + viewW,
				C.dim,
				C.chromeBg,
			);
			const act = ft.tabs.find((t) => t.active);
			if (act)
				this.drawClipped(
					buf,
					ft.text.slice(act.x0, act.x1),
					RAIL_W + act.x0,
					0,
					RAIL_W,
					RAIL_W + viewW,
					C.hot,
					C.chromeBg,
				);
			top = 1;
		}

		const availH = Math.max(1, viewH - top);
		const { w, h } = frameExtent(currentFrame(viewState));
		const pxW = Math.max(1, w * 2);
		const pxH = Math.max(1, h * 2);
		const spanX = visiblePixels(viewW, z);
		const spanY = visiblePixels(availH, z);
		const fitsX = pxW <= spanX;
		const fitsY = pxH <= spanY;
		// A fitting axis is always centred (wheel/pan cannot drift it off); a
		// larger-than-view axis follows the cursor or keeps its scrolled camera,
		// clamped to the frame.
		const followed = this.followCursor
			? {
					x: scrollAxis(this.cam.x, this.state.cursor.x, spanX, SCROLLOFF),
					y: scrollAxis(this.cam.y, this.state.cursor.y, spanY, SCROLLOFF),
				}
			: this.cam;
		this.cam = {
			x: fitsX ? 0 : clampScroll(followed.x, pxW, spanX),
			y: fitsY ? 0 : clampScroll(followed.y, pxH, spanY),
		};
		const origin = {
			x: RAIL_W + (fitsX ? centeredOrigin(pxW * z, viewW) : 0),
			y: top + (fitsY ? centeredOrigin(pxH * z, availH) : 0),
		};
		this.geom.focus = { tabs, origin, top };

		// Onion ghosts only source the active Frame; while playing the display
		// frame is not it (and the layers are empty anyway).
		const onion = viewState.frame === this.state.frame;
		for (let sy = top; sy < viewH; sy++) {
			for (let sx = RAIL_W; sx < RAIL_W + viewW; sx++) {
				const px = this.cam.x + Math.floor((sx - origin.x) / z);
				const py = this.cam.y + Math.floor((sy - origin.y) / z);
				buf.setCell(
					sx,
					sy,
					' ',
					C.dim,
					this.pixelRGBA(viewState, px, py, sx + sy, C, onion),
				);
			}
		}

		for (const m of anchorMarkers(viewState)) {
			const sx = origin.x + (m.x * 2 - this.cam.x) * z;
			const sy = origin.y + (m.y * 2 - this.cam.y) * z;
			if (sx < RAIL_W || sx >= RAIL_W + viewW || sy < top || sy >= viewH)
				continue;
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? C.overrideFg : C.anchorFg,
				C.bg,
			);
		}

		const bx = origin.x + (this.state.cursor.x - this.cam.x) * z;
		const by = origin.y + (this.state.cursor.y - this.cam.y) * z;
		this.drawCursorRing(
			buf,
			bx,
			by,
			{ x0: RAIL_W, x1: RAIL_W + viewW, y0: top, y1: viewH },
			(sx, sy) =>
				this.pixelRGBA(
					this.state,
					this.state.cursor.x,
					this.state.cursor.y,
					sx + sy,
					C,
					onion,
				),
			C,
		);
	}

	protected renderSelf(buf: OptimizedBuffer): void {
		const W = buf.width;
		const H = buf.height;
		const viewH = Math.max(1, H - CHROME_H);
		const C: Palette = {
			bg: RGBA.fromInts(16, 18, 26, 255),
			grid: RGBA.fromInts(28, 32, 44, 255),
			chromeBg: RGBA.fromInts(22, 25, 34, 255),
			text: RGBA.fromInts(232, 232, 238, 255),
			dim: RGBA.fromInts(140, 148, 164, 255),
			feedback: RGBA.fromInts(255, 180, 80, 255),
			ok: RGBA.fromInts(140, 220, 150, 255),
			cursorBg: RGBA.fromInts(245, 215, 95, 255),
			cursorFg: RGBA.fromInts(20, 22, 30, 255),
			ink: RGBA.fromInts(232, 232, 238, 255),
			boxBg: RGBA.fromInts(30, 34, 48, 255),
			hot: RGBA.fromInts(245, 215, 95, 255),
			divider: RGBA.fromInts(48, 54, 72, 255),
			anchorFg: RGBA.fromInts(120, 230, 255, 255),
			overrideFg: RGBA.fromInts(255, 210, 120, 255),
		};

		buf.fillRect(0, 0, W, H, C.bg);

		// The frame the canvas shows this instant (the edit frame, or the animated
		// frame during playback). cellAt only reads doc + frame name, so a shallow
		// state copy re-points it at the display frame without any mutation.
		const displayFrame = this.displayFrame;
		const viewState =
			displayFrame === this.state.frame
				? this.state
				: { ...this.state, frame: displayFrame };

		// The canvas region sits right of the rail; a right-hand panel, when
		// toggled, takes half of it with a one-column divider between. The
		// Composited preview (`o`) wins the panel over the mirror when both are on.
		const rightPanel = this.composite
			? 'composite'
			: this.mirror
				? 'mirror'
				: 'none';
		const canvasW = Math.max(1, W - RAIL_W);
		const viewW =
			rightPanel === 'none'
				? canvasW
				: Math.max(1, Math.floor((canvasW - 1) / 2));
		this.geom.viewH = viewH;
		this.geom.viewW = viewW;

		this.renderRail(buf, viewH, C);

		// Source the onion ghosts for this frame (empty while playing / onion off).
		this.buildOnionLayers(C);

		// Playback reviews motion on the single-frame canvas whichever view is
		// active — the strips grid is a poor movie screen.
		if (this.playMode !== 'none') {
			this.renderFocus(buf, viewW, viewH, viewState, false, C);
		} else if (this.view === 'focus') {
			this.renderFocus(buf, viewW, viewH, viewState, true, C);
		} else {
			this.renderStrips(buf, viewW, viewH, C);
		}

		if (rightPanel === 'mirror') {
			this.renderMirror(buf, RAIL_W + viewW, W, viewH, displayFrame, C);
		} else if (rightPanel === 'composite') {
			this.renderComposite(buf, RAIL_W + viewW, W, viewH, displayFrame, C);
		}

		// Chrome: the status line (with the coercion feedback right-aligned on
		// it), then the context-sensitive hint line (spec #387).
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
		// The coercion note rides the right of the status row. Draw the composed
		// line, then re-tint just the note when it made the cut so it stands out.
		const feedback = this.state.feedback;
		const status = composeStatusLine(statusLeft, feedback, W);
		const statusRow = H - CHROME_H;
		buf.fillRect(0, statusRow, W, 1, C.chromeBg);
		buf.drawText(status, 0, statusRow, C.text, C.chromeBg);
		if (feedback && status.endsWith(feedback)) {
			const rx = status.length - feedback.length;
			buf.drawText(feedback, rx, statusRow, C.feedback, C.chromeBg);
		}

		// The hint line: transient states (playback / stamp-await / a fresh save)
		// take it over; otherwise the active tool's keys plus the globals, led by
		// any role-required hint.
		const hintRow = H - 1;
		buf.fillRect(0, hintRow, W, 1, C.chromeBg);
		if (this.playMode !== 'none') {
			const label =
				this.playMode === 'walk'
					? `▶ walk preview (${displayFrame}) — . or , stops`
					: `▶ playing ${this.state.pose} (${displayFrame}) — . or , stops`;
			buf.drawText(label.slice(0, W), 0, hintRow, C.hot, C.chromeBg);
		} else if (this.awaitingStamp) {
			buf.drawText(
				'stamp: press a character to place (Esc cancels)'.slice(0, W),
				0,
				hintRow,
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
				hintRow,
				clean ? C.ok : C.feedback,
				C.chromeBg,
			);
		} else {
			const required = requiredHintLine(this.state.doc, this.role);
			const hints = hintLine(this.state.tool);
			const line = required ? `${required} ┃ ${hints}` : hints;
			buf.drawText(line.slice(0, W), 0, hintRow, C.dim, C.chromeBg);
		}

		this.renderHelp(buf, W, H, C);
		this.renderPicker(buf, W, H, C);
		this.renderPoseMenu(buf, W, H, C);
		this.renderAnchorMenu(buf, W, H, C);
	}

	// The read-only left-facing render of the current frame, drawn into the
	// right-hand region [dividerX+1, W).
	private renderMirror(
		buf: OptimizedBuffer,
		dividerX: number,
		W: number,
		viewH: number,
		frameName: string,
		C: Palette,
	): void {
		for (let sy = 0; sy < viewH; sy++)
			buf.setCell(dividerX, sy, '│', C.divider, C.bg);
		const ox = dividerX + 1;
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
					buf.setCell(ox + sx, sy, ' ', C.dim, checker ? C.grid : C.bg);
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
					fg ? SpriteEditor.rgba(fg) : C.ink,
					bg ? SpriteEditor.rgba(bg) : C.bg,
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
				a.overridden ? C.overrideFg : C.anchorFg,
				C.bg,
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
		dividerX: number,
		W: number,
		viewH: number,
		frameName: string,
		C: Palette,
	): void {
		for (let sy = 0; sy < viewH; sy++)
			buf.setCell(dividerX, sy, '│', C.divider, C.bg);
		const ox = dividerX + 1;
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
			buf.drawText(msg.slice(0, panelW), ox, 0, C.dim, C.bg);
		}
	}

	// The `?` overlay: the complete grouped key map (spec #387).
	private renderHelp(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		C: Palette,
	): void {
		if (!this.helpOpen) return;
		this.drawModal(buf, W, H, helpOverlayRows(H - 2), C);
	}

	private renderPicker(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		C: Palette,
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
	// highlighted. Shared by the picker, the pose/anchor menus and the help
	// overlay.
	private drawModal(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		rows: string[],
		C: Palette,
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
		C: Palette,
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
		C: Palette,
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
