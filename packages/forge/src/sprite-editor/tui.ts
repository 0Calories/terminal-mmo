// The `@opentui/core` glue for the Sprite editor (ADR 0031): a single Renderable
// that draws the pure editor state and a `key()` dispatcher that mutates it
// through the pure ops in `state.ts`. All logic lives in the pure modules
// (`state.ts`, `chrome.ts`, `strips.ts`, `colorPicker.ts`, `view.ts`); this file only
// wires them to the screen buffer, keyboard and mouse, mirroring the zone
// editor's `editor.ts` structure. The Renderable is exported so the TUI can be
// smoke-tested headlessly with `@opentui/core/testing`.
//
// Layout (spec #387, locked by prototype #375): a 30-column left rail (tools ·
// ink · playback), the canvas region beside it in one of two views — STRIPS
// (default; every Animation a labeled strip of editable Frames) and FOCUS (`tab`;
// one Frame centred under a Frame-name tab row) — and a two-row bottom chrome:
// the status line (coercion feedback right-aligned) over a context-sensitive
// hint line. `?` opens the complete grouped key map.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RGBAQuad } from '@mmo/core/entities';
import { STANDARD_PALETTE } from '@mmo/core/entities';
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
import {
	backspaceHex,
	type ColorPickerAction,
	type ColorPickerState,
	moveCursor as colorPickerMove,
	commitColorPicker,
	gridColor,
	HUE_COLS,
	openColorPicker,
	pickCell,
	SHADE_ROWS,
	typeHex,
} from './colorPicker';
import { renderComposite, styleWithLocalColors } from './composite';
import {
	CHROME_ROWS,
	type DegradationLayout,
	PREVIEW_H,
	PREVIEW_W,
	previewVisible,
	solveDegradation,
} from './degradation';
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
	type AnimationMenuAction,
	type AnimationMenuState,
	type AnimationRow,
	anchorMenuKey,
	animationMenuKey,
	type MenuKey,
	openAnchorMenu,
	openAnimationMenu,
	syncAnimationMenu,
} from './menus';
import { cycleOnionDepth, ghostColor, onionGhosts } from './onion';
import { animationFps, playbackFrame, walkPreviewIndex } from './playback';
import { normalizeDoc } from './resize';
import {
	addFrameToAnimation,
	anchorMarkers,
	animationFrames,
	animationNames,
	beginResize,
	beginStroke,
	cancelFloat,
	cancelResize,
	cancelShape,
	cellAt,
	clearSelection,
	colorInk,
	commitFloat,
	commitResize,
	copySelection,
	createAnimation,
	cropToSelection,
	currentFrame,
	cutSelection,
	type DynamicPreviews,
	defineLocalColor,
	deleteAnimation,
	deleteSelection,
	endStroke,
	floatDisplayDoc,
	frameExtent,
	frameNames,
	type Ink,
	initSpriteEditor,
	inkLabel,
	isShapeTool,
	moveCursor,
	nudgeFloat,
	paletteEntries,
	pasteFromClipboard,
	pixelToCell,
	placeAnchor,
	readPixel,
	redoEdit,
	reorderFrame,
	resizeCycleEdge,
	resizeNudge,
	type SpriteEditorState,
	type SpriteTool,
	saveResult,
	selectAll,
	selectAnimation,
	selectFrame,
	selectionOverlay,
	setAnchorName,
	setAnchorScope,
	setAnimationFps,
	setInk,
	setTool,
	shapePreviewPixels,
	stampGlyph,
	TRANSPARENT_INK,
	toggleShapeMode,
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
	comanimationStatusLine,
	DEFAULT_ZOOM,
	dirForRole,
	docDynamicUsage,
	mirrorAnchorMarkers,
	mirrorRender,
	missingRequiredAnchors,
	parseEditArg,
	requiredHintLine,
	resolveColorKey,
	roleForDir,
	saveDiagSummary,
	scrollAxis,
	spriteStatusLine,
	stepZoom,
	variantOptions,
	variantPreviews,
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
	// Shown in the status line's feedback slot on open (e.g. "creating new
	// sprite …"), so a fresh-template open is never mistaken for a loaded file.
	initialFeedback?: string;
}

// Two chrome rows: the status line and the hint line under it (spec #387).
// Owned by the degradation solver so it and the renderer agree on the canvas
// interior's height.
const CHROME_H = CHROME_ROWS;
const SCROLLOFF = 2;

// PREVIEW_W / PREVIEW_H (the floating Composited preview's native ~34×11) now
// live in `degradation.ts` alongside the ≥80×24 floor, so the solver and the
// renderer size the pane identically.

// The Pixel delta each arrow / vim key nudges by (used for whole-Frame shift).
const ARROW_DELTA: Record<string, { dx: number; dy: number }> = {
	left: { dx: -1, dy: 0 },
	h: { dx: -1, dy: 0 },
	right: { dx: 1, dy: 0 },
	l: { dx: 1, dy: 0 },
	up: { dx: 0, dy: -1 },
	k: { dx: 0, dy: -1 },
	down: { dx: 0, dy: 1 },
	j: { dx: 0, dy: 1 },
};

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
type PlayMode = 'none' | 'animation' | 'walk';

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
	// The `e` file-local colour picker modal (spec #387, #401): define a new local
	// colour or edit an existing one, over a hue/shade grid + hex entry.
	colorPicker: ColorPickerState | null = null;
	// The `c` ink quick-pick overlay (spec #387): random-access ink selection.
	animationMenu: AnimationMenuState | null = null;
	anchorMenu: AnchorMenuState | null = null;
	mirror = false;
	// The always-on floating Composited preview (#393): the WIP art rendered the way
	// the game draws it, docked top-right over the canvas. It is shown by default so
	// the artist always draws against the truth. On a small terminal rung 1 (spec
	// #398) auto-hides it; `v` sets a manual override that wins in BOTH directions
	// (force it visible when auto-hidden, hidden when auto-shown). `previewOverride`
	// is null when following the auto rung; `autoPreview` is the last render's
	// automatic decision, so `composite` is legible between renders.
	previewOverride: boolean | null = null;
	private autoPreview = true;
	// The last render's degradation-ladder decisions for the strips→focus rung and
	// its status hint (spec #398). The preview rung reads through `composite`.
	private forceFocus = false;
	private foldPlayback = false;
	private focusHint = '';
	// The effective preview visibility (rung 1 + manual override). Read by the
	// renderer and by tests right after a `v` press, before the next render.
	get composite(): boolean {
		return previewVisible(this.autoPreview, this.previewOverride);
	}
	// The preview pane's own facing, flipped by its flip control. Independent of the
	// canvas `mirror` split so flipping the preview never opens the mirror panel.
	previewFacing: 1 | -1 = 1;
	// Which canvas view is active: strips (default) or focus (`tab`).
	view: CanvasView = 'strips';
	// Whether the `?` key-map overlay is open.
	helpOpen = false;
	private readonly sceneStyle: RenderStyle<RGBA>;
	awaitingStamp = false;
	// Animation playback is presentation only — it never touches the doc/history.
	playMode: PlayMode = 'none';
	private playElapsedMs = 0;
	// The session-selected dynamic variant (spec #401 as amended): indices into
	// the player-hue and rarity-accent cycles. Presentation only, never
	// persisted; every surface that resolves p/a reads it, so canvas, rail
	// swatches and composited preview always agree.
	private variant = { p: 0, a: 0 };
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
		// The floating preview pane's screen rect + its clickable control spans, so
		// mouse handlers can swallow clicks over the pane and hit flip/play.
		preview: {
			x0: number;
			y0: number;
			w: number;
			h: number;
			flip: { x0: number; x1: number; y: number };
			play: { x0: number; x1: number; y: number };
		} | null;
		// The colour picker's hue/shade grid rect, so a click resolves to a cell.
		colorGrid: {
			x0: number;
			y0: number;
			cellW: number;
			cellH: number;
		} | null;
	} = {
		viewH: 0,
		viewW: 0,
		rail: [],
		layout: null,
		focus: null,
		preview: null,
		colorGrid: null,
	};
	// An in-flight mouse paint stroke (down→drag→up coalesces to one undo step),
	// and the button held for it (drag events don't reliably re-report the button).
	private mouseStroke = false;
	private mouseButton: RawMouse['button'] = 'left';
	// An in-flight mouse shape gesture (down→drag→up) and the last Pixel it saw,
	// so the release commits at the endpoint even when the up event omits it.
	private mouseShape = false;
	private shapePx = { x: 0, y: 0 };
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
		if (opts.initialFeedback)
			this.state = { ...this.state, feedback: opts.initialFeedback };
		this.savedDoc = opts.doc;
		this.saveDiags = opts.initialDiags ?? null;
		this.save = opts.save;
		this.onQuit = opts.onQuit;
		// The rail lists (and the canvas resolves) the standard core palette by
		// default (spec #387, palette from #404): the single source of truth for
		// every paintable key, plus file-local customs and the dynamic p/a keys.
		this.globalPalette = opts.globalPalette ?? STANDARD_PALETTE;
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
		return paletteEntries(
			this.state,
			this.globalPalette,
			this.dynamicPreviews(),
		);
	}

	// The dynamic p/a colours for the session-selected variant (spec #401 as
	// amended): the canvas, shape preview, mirror AND the rail's swatches all
	// resolve painted `p`/`a` through these, so every surface agrees. Nothing
	// advances them but a click on the variant strip.
	private dynamicPreviews(): DynamicPreviews {
		return variantPreviews(this.variant.p, this.variant.a);
	}

	// The widest Frame's width in cells — the degradation solver scales it to
	// decide whether two full Frames fit at the current zoom (spec #398 rung 2).
	private maxFrameCellW(): number {
		return Math.max(1, ...this.state.doc.frames.map((f) => frameExtent(f).w));
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
		// Anchor gestures (geometry tools + the select marquee) place the anchor on
		// the first press and commit on the second; the move tool's Enter lifts a
		// float or drops a live one — all through the same normalized seam a mouse
		// gesture uses (spec #387, #399).
		if (
			isShapeTool(this.state.tool) ||
			this.state.tool === 'select' ||
			this.state.tool === 'move'
		) {
			const { x, y } = this.state.cursor;
			this.state = applyInput(
				this.state,
				normalizeKey({ pixel: { x, y }, paint: 'ink', phase: 'toggle' }),
			);
			this.followCursor = true;
			return;
		}
		// A non-anchor edit (paint/fill/stamp/anchor) drops any live whole-Frame
		// float first, so the shift is baked before new ink lands (spec #399).
		if (this.state.float) this.state = commitFloat(this.state);
		if (this.state.tool === 'anchor') {
			this.placeAnchorAtCursor();
			return;
		}
		if (this.state.tool === 'stamp') {
			this.awaitingStamp = true;
			this.state = { ...this.state, feedback: '' };
			return;
		}
		// Fill is a single-shot flood at the cursor — no pen toggle. The apply key
		// reaches floodFill through the same seam a left click uses.
		if (this.state.tool === 'fill') {
			this.applyAtCursor();
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
		const nx = Math.max(0, x + dx);
		const ny = Math.max(0, y + dy);
		this.followCursor = true;
		// The move tool arrow-nudges the float (lifting the selection on the first
		// nudge), leaving the cursor free of a paint stroke (spec #399).
		if (
			this.state.tool === 'move' &&
			(this.state.float || this.state.selection)
		) {
			this.state = nudgeFloat(this.state, dx, dy);
			return;
		}
		// A pending anchor gesture (shape or select marquee) follows the cursor as a
		// live preview; the seam's move phase steps the cursor and the endpoint
		// together (spec #387).
		if (isShapeTool(this.state.tool) || this.state.tool === 'select') {
			this.state = applyInput(
				this.state,
				normalizeKey({ pixel: { x: nx, y: ny }, paint: 'none', phase: 'move' }),
			);
			return;
		}
		this.state = moveCursor(this.state, nx, ny);
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
			this.colorPicker !== null ||
			this.animationMenu !== null ||
			this.anchorMenu !== null ||
			this.awaitingStamp ||
			this.helpOpen ||
			this.state.resize !== null ||
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

	// Feed one stage of a mouse shape gesture through the same seam: press starts
	// the shape, drag moves the endpoint, release commits (spec #387).
	private shapeMouse(
		phase: 'down' | 'drag' | 'up',
		button: RawMouse['button'],
		px: { x: number; y: number },
		modifiers?: SpriteMouse['modifiers'],
	): void {
		const raw: RawMouse = {
			pixel: px,
			button,
			phase,
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
			case 'play':
				this.togglePlay(action.mode);
				return;
			case 'addFrame':
				this.addFrame();
				return;
			case 'animationMenu':
				this.openAnimationMenu();
				return;
			case 'anchorMenu':
				this.openAnchorMenu();
				return;
			case 'variant':
				// Session-only: recolors previews, never the doc (spec #401 amendment).
				this.variant = { ...this.variant, [action.channel]: action.index };
				return;
		}
	}

	// A screen cell in the strips view's content coordinates (the unscrolled
	// grid stripsLayout lays out).
	private stripsContentAt(e: { x: number; y: number }): {
		cx: number;
		cy: number;
	} {
		return {
			cx: e.x - RAIL_W + this.scroll.x,
			cy: e.y + this.scroll.y,
		};
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
		// Follow the view actually rendered — rung 2 (spec #398) can force strips
		// into focus, so `geom.layout` (set only by the strips render) is the truth,
		// not `this.view`.
		if (this.geom.layout) {
			const layout = this.geom.layout;
			const { cx, cy } = this.stripsContentAt(e);
			const hit = stripsHit(layout, cx, cy);
			if (!hit) {
				// A click on a strip's name row activates that Frame without painting.
				const strip = layout.nameRows.indexOf(cy);
				if (strip >= 0) {
					const animation = layout.labels[strip].animation;
					const box = layout.frames.find(
						(f) => f.animation === animation && cx >= f.x && cx < f.x + f.w,
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
		// Momentary eyedrop (spec #387): an alt-click samples the key under the
		// pointer through the normalized seam — whatever tool is in hand — and never
		// opens a paint stroke or a shape gesture.
		if (e.modifiers?.alt) {
			this.paintMouse(button, px, e.modifiers);
			return;
		}
		// Anchor gestures open on press instead of a paint stroke: the geometry
		// tools (ink captured now, right → transparent), the select marquee, and the
		// move float (a grab inside the selection lifts it) all drive the same
		// press→drag→release plumbing through the normalized seam (spec #387, #399).
		if (
			isShapeTool(this.state.tool) ||
			this.state.tool === 'select' ||
			this.state.tool === 'move'
		) {
			this.mouseShape = true;
			this.mouseButton = button;
			this.shapePx = px;
			this.shapeMouse('down', button, px, e.modifiers);
			return;
		}
		// A paint press with a live whole-Frame float drops it first, so new ink
		// lands on the baked art (spec #399).
		if (this.state.float) this.state = commitFloat(this.state);
		// Fill floods on a single press (left = active ink, right = transparent);
		// no coalescing stroke, no drag.
		if (this.state.tool === 'fill') {
			this.paintMouse(button, px, e.modifiers);
			return;
		}
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
		// A click on the colour picker's grid lands the cursor on that swatch; the
		// modal otherwise swallows the click (spec #401: the grid is mouse-operable).
		if (this.colorPicker) {
			if (e.button === 0) this.colorPickerClick(e);
			return;
		}
		if (this.modalActive()) return;
		// The floating preview pane swallows every click over it (never paint the
		// canvas hidden beneath); a primary click on its flip/play controls actuates.
		const pane = this.geom.preview;
		if (
			pane &&
			e.x >= pane.x0 &&
			e.x < pane.x0 + pane.w &&
			e.y >= pane.y0 &&
			e.y < pane.y0 + pane.h
		) {
			if (e.button === 0) {
				if (e.y === pane.flip.y && e.x >= pane.flip.x0 && e.x <= pane.flip.x1) {
					this.previewFacing = this.previewFacing === 1 ? -1 : 1;
				} else if (
					e.y === pane.play.y &&
					e.x >= pane.play.x0 &&
					e.x <= pane.play.x1
				) {
					this.togglePlay('animation');
				}
			}
			return;
		}
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
		if (!this.mouseStroke && !this.mouseShape) return;
		// A drag off the canvas simply paints nothing until it returns; the held
		// button is remembered from mouseDown since drag reports vary by terminal.
		let px: { x: number; y: number } | null = null;
		if (this.geom.layout) {
			const layout = this.geom.layout;
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
		if (this.mouseShape) {
			this.shapePx = px;
			this.shapeMouse('drag', this.mouseButton, px, e.modifiers);
			return;
		}
		this.paintMouse(this.mouseButton, px, e.modifiers);
	}

	mouseUp(_e?: unknown): void {
		this.panLast = null;
		if (this.mouseShape) {
			// The release commits the shape at the last dragged Pixel as one undo
			// step; a plain click (no drag) commits a one-Pixel degenerate shape.
			this.shapeMouse('up', this.mouseButton, this.shapePx);
			this.mouseShape = false;
		}
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

	// ---- colour picker (`e`) ----

	// Open the define/edit colour modal for the active ink (edits an existing
	// file-local colour, else defines a fresh one under an auto-assigned key).
	private openColorPickerModal(): void {
		this.liftPen();
		this.colorPicker = openColorPicker(
			this.state,
			Object.keys(this.globalPalette),
		);
	}

	private applyColorPickerAction(action: ColorPickerAction): void {
		// One path for define and edit: (re)define the local colour, then make it
		// the active ink. Editing an existing key overwrites it, so every Pixel
		// already painted with that key repaints to the new colour (spec #401).
		this.state = defineLocalColor(this.state, action.key, action.rgba);
		if (this.state.doc.colors[action.key])
			this.state = setInk(this.state, colorInk(action.key));
	}

	private colorPickerKey(k: SpriteKey): void {
		const p = this.colorPicker;
		if (!p) return;
		if (k.name === 'escape') {
			this.colorPicker = null;
			return;
		}
		if (k.name === 'return' || k.name === 'enter') {
			const res = commitColorPicker(p);
			this.colorPicker = res.picker;
			if (res.action) this.applyColorPickerAction(res.action);
			return;
		}
		if (k.name === 'backspace') {
			this.colorPicker = backspaceHex(p);
			return;
		}
		if (k.name === 'left') {
			this.colorPicker = colorPickerMove(p, -1, 0);
			return;
		}
		if (k.name === 'right') {
			this.colorPicker = colorPickerMove(p, 1, 0);
			return;
		}
		if (k.name === 'up') {
			this.colorPicker = colorPickerMove(p, 0, -1);
			return;
		}
		if (k.name === 'down') {
			this.colorPicker = colorPickerMove(p, 0, 1);
			return;
		}
		// Any other printable char is hex typeahead (digits + a–f; others ignored).
		const ch = k.sequence ?? '';
		if (ch.length === 1) this.colorPicker = typeHex(p, ch);
	}

	// Resolve a click over the colour picker's hue/shade grid to a cell and land
	// the cursor there; clicks off the grid are ignored (the modal stays open).
	private colorPickerClick(e: SpriteMouse): void {
		const p = this.colorPicker;
		const g = this.geom.colorGrid;
		if (!p || !g) return;
		const col = Math.floor((e.x - g.x0) / g.cellW);
		const row = Math.floor((e.y - g.y0) / g.cellH);
		if (col < 0 || col >= HUE_COLS || row < 0 || row >= SHADE_ROWS) return;
		this.colorPicker = pickCell(p, col, row);
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

	// ---- frames / animations / edits ----

	private stepFrame(delta: number): void {
		this.liftPen();
		const names = frameNames(this.state);
		const i = names.indexOf(this.state.frame);
		const next = names[(i + delta + names.length) % names.length];
		if (next) this.state = selectFrame(this.state, next);
		this.followCursor = true;
	}

	private stepAnimation(delta: number): void {
		this.liftPen();
		const names = animationNames(this.state);
		if (names.length === 0) return;
		const i = Math.max(0, names.indexOf(this.state.animation));
		const next = names[(i + delta + names.length) % names.length];
		this.state = selectAnimation(this.state, next);
		this.followCursor = true;
	}

	private addFrame(): void {
		this.liftPen();
		this.state = addFrameToAnimation(this.state, this.state.animation);
		this.followCursor = true;
	}

	private toggleView(): void {
		this.liftPen();
		this.view = this.view === 'strips' ? 'focus' : 'strips';
		this.followCursor = true;
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
		this.state = cancelShape(this.state);
		// A live float is dropped (not discarded) when the tool changes, so the
		// move isn't silently lost; the selection survives the switch so a select →
		// move handoff keeps the marquee (spec #399).
		if (this.state.float) this.state = commitFloat(this.state);
		// `paste` (rail 9) is a trigger, not a resting mode: hand off to move and
		// spawn a paste float at the source coordinates (spec #400). If the
		// clipboard is empty pasteFromClipboard refuses and move stays selected.
		if (tool === 'paste') {
			this.state = pasteFromClipboard(setTool(this.state, 'move'));
			this.followCursor = true;
			return;
		}
		this.state = setTool(this.state, tool);
	}

	// ---- animation menu ----

	private animationRows(): AnimationRow[] {
		return animationNames(this.state).map((name) => ({
			name,
			frameCount: animationFrames(this.state, name).length,
			fps: this.state.doc.fps[name] ?? null,
		}));
	}

	private openAnimationMenu(): void {
		this.liftPen();
		this.animationMenu = openAnimationMenu(
			this.animationRows(),
			this.state.animation,
		);
	}

	private applyAnimationAction(action: AnimationMenuAction): void {
		switch (action.type) {
			case 'switch':
				this.state = selectAnimation(this.state, action.animation);
				break;
			case 'create':
				this.state = createAnimation(this.state, action.name);
				break;
			case 'delete':
				this.state = deleteAnimation(this.state, action.animation);
				break;
			case 'addFrame':
				this.state = addFrameToAnimation(this.state, action.animation);
				break;
			case 'reorder':
				this.state = reorderFrame(
					this.state,
					action.animation,
					action.index,
					action.delta,
				);
				break;
			case 'setFps':
				this.state = setAnimationFps(this.state, action.animation, action.fps);
				break;
			case 'close':
				break;
		}
	}

	private animationMenuKeyDispatch(k: SpriteKey): void {
		const menu = this.animationMenu;
		if (!menu) return;
		const res = animationMenuKey(menu, toMenuKey(k));
		if (res.action && res.action.type !== 'close') {
			const keep = res.action.type === 'create' ? res.action.name : undefined;
			this.applyAnimationAction(res.action);
			// 'switch' closes the menu; everything else stays open, re-synced.
			if (res.action.type === 'switch') this.animationMenu = null;
			else
				this.animationMenu = syncAnimationMenu(
					menu,
					this.animationRows(),
					keep,
				);
		} else {
			this.animationMenu = res.menu;
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

	// ---- whole-file resize mode (spec #402) ----

	// The arrow that grows the selected edge outward; its opposite shrinks it in.
	private resizeArrowDir(name: string | undefined): 1 | -1 | 0 {
		const edge = this.state.resize;
		if (!edge) return 0;
		switch (edge) {
			case 'left':
				if (name === 'left' || name === 'h') return 1;
				if (name === 'right' || name === 'l') return -1;
				return 0;
			case 'right':
				if (name === 'right' || name === 'l') return 1;
				if (name === 'left' || name === 'h') return -1;
				return 0;
			case 'top':
				if (name === 'up' || name === 'k') return 1;
				if (name === 'down' || name === 'j') return -1;
				return 0;
			default:
				if (name === 'down' || name === 'j') return 1;
				if (name === 'up' || name === 'k') return -1;
				return 0;
		}
	}

	private resizeKeyDispatch(k: SpriteKey): void {
		if (k.name === 'escape') {
			this.state = cancelResize(this.state);
			return;
		}
		if (k.name === 'return' || k.name === 'enter') {
			this.state = commitResize(this.state);
			return;
		}
		if (k.name === 'tab') {
			this.state = resizeCycleEdge(this.state);
			return;
		}
		const dir = this.resizeArrowDir(k.name);
		if (dir !== 0) {
			this.state = resizeNudge(this.state, dir);
			this.followCursor = true;
		}
	}

	// ---- playback (presentation only) ----

	private togglePlay(mode: 'animation' | 'walk'): void {
		this.liftPen();
		this.playMode = this.playMode === mode ? 'none' : mode;
		this.playElapsedMs = 0;
	}

	// The `v` degradation override (spec #398): set a manual preview preference
	// that wins over the auto rung in both directions — flip whatever is showing
	// now. Reading `composite` folds in the current auto decision, so pressing `v`
	// while auto-hidden forces it visible, and while auto-shown forces it hidden.
	private togglePreview(): void {
		this.previewOverride = !this.composite;
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
			const frames = animationFrames(this.state, 'walk');
			const idx = walkPreviewIndex(frames.length, this.playElapsedMs / 1000);
			return frames[idx] ?? this.state.frame;
		}
		if (this.playMode === 'animation') {
			const frames = animationFrames(this.state, this.state.animation);
			if (frames.length === 0) return this.state.frame;
			const fps = animationFps(this.state.doc.fps, this.state.animation);
			const idx = playbackFrame(frames.length, this.playElapsedMs / 1000, fps);
			return frames[idx] ?? this.state.frame;
		}
		return this.state.frame;
	}

	// The editing state the canvas + Composited preview render: while a float
	// rides, its current Frame's doc is the source hole plus the float at its live
	// offset, exactly as a drop would commit it (spec #399). Identity otherwise, so
	// no float is a zero-cost passthrough.
	private floatState(): SpriteEditorState {
		if (!this.state.float) return this.state;
		return { ...this.state, doc: floatDisplayDoc(this.state) };
	}

	// The single keyboard entry point.
	key(k: SpriteKey): void {
		if (this.helpOpen) {
			if (k.sequence === '?' || k.name === 'escape' || k.name === 'q')
				this.helpOpen = false;
			return;
		}
		this.dismissSaveNotice();
		if (this.colorPicker) {
			this.colorPickerKey(k);
			return;
		}
		if (this.animationMenu) {
			this.animationMenuKeyDispatch(k);
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
		// Whole-file resize mode (spec #402) owns the canvas: tab cycles the edge,
		// arrows nudge the selected edge in/out, enter commits (one undo step), esc
		// cancels losslessly.
		if (this.state.resize) {
			this.resizeKeyDispatch(k);
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
				this.togglePreview();
				return;
			}
			if (k.sequence === '.') {
				this.togglePlay('animation');
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

		// Esc backs out an in-flight float, then a shape, then a committed selection,
		// each losslessly (spec #387, #399); with nothing pending it surfaces the
		// focus view back to the strips overview (modals/help/stamp consume their
		// own esc above).
		if (k.name === 'escape') {
			if (this.state.float) this.state = cancelFloat(this.state);
			else if (this.state.shape) this.state = cancelShape(this.state);
			else if (this.state.selection) this.state = clearSelection(this.state);
			else if (this.view === 'focus') {
				this.liftPen();
				this.view = 'strips';
				this.followCursor = true;
			}
			return;
		}
		// Enter drops a live float from any tool — a whole-Frame shift (which can
		// float under the pencil or any tool) commits the same way a move-tool drop
		// does (spec #399).
		if (
			(k.name === 'return' || k.name === 'enter') &&
			this.state.float &&
			this.state.tool !== 'move'
		) {
			this.liftPen();
			this.state = commitFloat(this.state);
			return;
		}
		// Delete / backspace clear the selection's contents as one undo step.
		if (k.name === 'delete' || k.name === 'backspace') {
			this.liftPen();
			this.state = deleteSelection(this.state);
			return;
		}
		// Copy / cut the selection to the in-editor clipboard (spec #400). `y` is a
		// pure read; `x` copies then clears as one undo step. Both keep the
		// selection so a paste can follow. (ctrl+y = redo is handled below and uses
		// a control sequence, so a bare `y`/`x` never collides.)
		if (k.sequence === 'y') {
			this.liftPen();
			this.state = copySelection(this.state);
			return;
		}
		if (k.sequence === 'x') {
			this.liftPen();
			this.state = cutSelection(this.state);
			return;
		}
		// Whole-Frame shift (spec #399): shift + an arrow = select-all + float,
		// nudged one Pixel. Reuses the float machinery, no new gesture.
		if (k.shift) {
			const d = ARROW_DELTA[k.name];
			if (d) {
				this.liftPen();
				if (!this.state.float) this.state = selectAll(this.state);
				this.state = nudgeFloat(this.state, d.dx, d.dy);
				this.followCursor = true;
				return;
			}
		}
		// Toggle the active geometry tool's outline↔filled mode (spec #387).
		if (k.name === 'o') {
			this.liftPen();
			this.state = toggleShapeMode(this.state);
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
		// Animations / anchors / mirror / playback (checked by sequence so shift/plain
		// variants are unambiguous).
		if (k.sequence === 'P') {
			this.openAnimationMenu();
			return;
		}
		if (k.sequence === 'A') {
			this.openAnchorMenu();
			return;
		}
		// Whole-file sizing (spec #402): `R` enters resize mode; crop lives on
		// plain `c` (see the switch below — C is unbound).
		if (k.sequence === 'R') {
			this.liftPen();
			this.state = beginResize(this.state);
			return;
		}
		if (k.name === 'm') {
			this.mirror = !this.mirror;
			return;
		}
		if (k.name === 'v') {
			this.togglePreview();
			return;
		}
		if (k.sequence === '.') {
			this.togglePlay('animation');
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
		// Animation stepping and the strips ↔ focus toggle.
		if (k.sequence === '{') {
			this.stepAnimation(-1);
			return;
		}
		if (k.sequence === '}') {
			this.stepAnimation(1);
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
				this.primary();
				return;
			case 'return':
			case 'enter':
				// Focus navigation: a bare enter in the strips overview dives into
				// the active frame. Gesture claims come first — a float drop was
				// handled above, and the gesture tools (shape/select/move) keep
				// enter as their anchor/commit/lift key via primary().
				if (
					this.view === 'strips' &&
					!this.state.shape &&
					!this.state.float &&
					!isShapeTool(this.state.tool) &&
					this.state.tool !== 'select' &&
					this.state.tool !== 'move'
				) {
					this.liftPen();
					this.view = 'focus';
					this.followCursor = true;
					return;
				}
				this.primary();
				return;
			case 'p':
				this.switchTool('paint');
				return;
			case 'e':
				this.openColorPickerModal();
				return;
			case 's':
				this.switchTool('stamp');
				return;
			case 'a':
				this.switchTool('anchor');
				return;
			case 't':
				this.liftPen();
				this.state = setInk(this.state, TRANSPARENT_INK);
				return;
			case 'c':
				// Crop to the committed selection (rebound from the retired ink
				// quick-pick; C stays unbound). Plain c only — shift-c is inert.
				if (k.shift || k.sequence === 'C') return;
				this.liftPen();
				this.state = cropToSelection(this.state);
				this.followCursor = true;
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
	// tint per neighbouring Frame the active Animation sources at the current depth,
	// nearest first. Empty while playing (playback suspends ghosts, spec #387) or
	// when onion is off, so `onionGhostRGBA` is a cheap no-op then.
	private buildOnionLayers(C: Palette): void {
		if (this.playMode !== 'none' || this.onionDepth <= 0) {
			this.onionLayers = [];
			return;
		}
		const frames = animationFrames(this.state, this.state.animation);
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
		const previews = this.dynamicPreviews();
		const { cellX, cellY, bit } = pixelToCell(px, py);
		const cell = cellAt(st, cellX, cellY);
		const lit = cell.mask !== undefined && (cell.mask & (1 << bit)) !== 0;
		if (lit) {
			// A SENTINEL fg means "the frame's default key" (as the mirror does).
			const fgKey = cell.fg === SENTINEL ? this.state.doc.key : cell.fg;
			const fg = resolveColorKey(fgKey, local, this.globalPalette, previews);
			return fg ? SpriteEditor.rgba(fg) : C.ink;
		}
		const bgKey = cell.bg === SENTINEL ? '' : cell.bg;
		const bg =
			cell.mask === undefined
				? null
				: resolveColorKey(bgKey, local, this.globalPalette, previews);
		if (bg) return SpriteEditor.rgba(bg);
		// Transparent Pixel: an onion ghost shows through it under the art (active
		// Frame only), else the checkerboard.
		if (onion) {
			const ghost = this.onionGhostRGBA(px, py);
			if (ghost) return ghost;
		}
		return phase % 2 === 0 ? C.grid : C.bg;
	}

	// The colour a pending shape's preview Pixels tint to: the resolved ink, or a
	// muted marker for the transparent ink (which paints no colour but must still
	// show where the shape lands).
	private previewRGBA(ink: Ink, C: Palette): RGBA {
		if (ink.kind === 'transparent') return C.dim;
		const rgba = resolveColorKey(
			ink.key,
			this.state.doc.colors,
			this.globalPalette,
			this.dynamicPreviews(),
		);
		return rgba ? SpriteEditor.rgba(rgba) : C.ink;
	}

	// Overlay the pending shape's live preview (spec #387): each in-bounds preview
	// Pixel's z×z block, tinted by the shape's ink, mapped to the screen by the
	// active view's geometry and clipped to the canvas region.
	private drawShapePreview(
		buf: OptimizedBuffer,
		mapPx: (px: number, py: number) => { x: number; y: number },
		clip: { x0: number; x1: number; y0: number; y1: number },
		C: Palette,
	): void {
		if (!this.state.shape) return;
		const z = this.zoom;
		const color = this.previewRGBA(this.state.shape.ink, C);
		for (const p of shapePreviewPixels(this.state)) {
			const o = mapPx(p.x, p.y);
			for (let dy = 0; dy < z; dy++)
				for (let dx = 0; dx < z; dx++) {
					const sx = o.x + dx;
					const sy = o.y + dy;
					if (sx < clip.x0 || sx >= clip.x1 || sy < clip.y0 || sy >= clip.y1)
						continue;
					buf.setCell(sx, sy, ' ', C.dim, color);
				}
		}
	}

	// Overlay the selection marquee (spec #387, #399): the border Pixels of the
	// committed selection, or of the float's rectangle at its live offset while a
	// float rides. Each border Pixel's z×z block is edged so the ants read at any
	// zoom without occluding the art inside.
	private drawSelectionMarquee(
		buf: OptimizedBuffer,
		disp: SpriteEditorState,
		mapPx: (px: number, py: number) => { x: number; y: number },
		clip: { x0: number; x1: number; y0: number; y1: number },
		C: Palette,
	): void {
		const sel = selectionOverlay(this.state);
		if (!sel) return;
		const z = this.zoom;
		const marquee = this.state.float ? C.hot : C.anchorFg;
		for (let py = sel.y0; py <= sel.y1; py++)
			for (let px = sel.x0; px <= sel.x1; px++) {
				const border =
					px === sel.x0 || px === sel.x1 || py === sel.y0 || py === sel.y1;
				if (!border) continue;
				const o = mapPx(px, py);
				const under = this.pixelRGBA(disp, px, py, px + py, C, false);
				for (let dy = 0; dy < z; dy++)
					for (let dx = 0; dx < z; dx++) {
						// Only the outermost ring of the block, so the art stays visible.
						const edge =
							(px === sel.x0 && dx === 0) ||
							(px === sel.x1 && dx === z - 1) ||
							(py === sel.y0 && dy === 0) ||
							(py === sel.y1 && dy === z - 1);
						if (!edge) continue;
						const sx = o.x + dx;
						const sy = o.y + dy;
						if (sx < clip.x0 || sx >= clip.x1 || sy < clip.y0 || sy >= clip.y1)
							continue;
						buf.setCell(sx, sy, '·', marquee, under);
					}
			}
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

	// The 30-column left rail: tools · ink · playback, with a divider column. The
	// rail never hides (spec #398 rung 4); when the terminal is short its playback
	// box folds (rung 3) so the ink list keeps room.
	private renderRail(buf: OptimizedBuffer, viewH: number, C: Palette): void {
		buf.fillRect(0, 0, RAIL_W - 1, viewH, C.chromeBg);
		for (let y = 0; y < viewH; y++)
			buf.setCell(RAIL_W - 1, y, '│', C.divider, C.bg);
		const rows = railModel({
			tool: this.state.tool,
			ink: this.state.ink,
			entries: this.entries(),
			animation: this.state.animation,
			fps: animationFps(this.state.doc.fps, this.state.animation),
			frameCount: animationFrames(this.state, this.state.animation).length,
			playMode: this.playMode,
			onionDepth: this.onionDepth,
			height: viewH,
			foldPlayback: this.foldPlayback,
			variants: variantOptions(docDynamicUsage(this.state.doc), this.variant),
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

	// STRIPS: every Animation a labeled horizontal strip of its Frames, all editable
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

		const disp = this.floatState();
		for (const box of layout.frames) {
			const active = box.name === this.state.frame;
			const st = active ? disp : { ...this.state, frame: box.name };
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
				if (box.animation !== label.animation) continue;
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
		// their (2×,2×) Pixel block (overrides tinted apart). The background is
		// whatever that cell renders without the marker — the art's colour, or
		// the transparency checker — never an opaque stamp (QA round 3).
		for (const m of anchorMarkers(this.state)) {
			const ccx = activeBox.x + m.x * 2 * z;
			const ccy = activeBox.y + m.y * 2 * z;
			const sx = sxOf(ccx);
			const sy = syOf(ccy);
			if (sx < x0 || sx >= x1 || sy < 0 || sy >= viewH) continue;
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? C.overrideFg : C.anchorFg,
				this.pixelRGBA(disp, m.x * 2, m.y * 2, ccx + ccy, C, true),
			);
		}

		// The pending shape's live preview overlays the active Frame's art.
		const mapActive = (px: number, py: number) => ({
			x: sxOf(activeBox.x + px * z),
			y: syOf(activeBox.y + py * z),
		});
		this.drawShapePreview(buf, mapActive, { x0, x1, y0: 0, y1: viewH }, C);
		this.drawSelectionMarquee(
			buf,
			disp,
			mapActive,
			{ x0, x1, y0: 0, y1: viewH },
			C,
		);

		const bx = sxOf(activeBox.x + this.state.cursor.x * z);
		const by = syOf(activeBox.y + this.state.cursor.y * z);
		this.drawCursorRing(
			buf,
			bx,
			by,
			{ x0, x1, y0: 0, y1: viewH },
			(sx, sy) =>
				this.pixelRGBA(
					disp,
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
			const frames = animationFrames(this.state, this.state.animation);
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
				// The cell's own rendered background — art or checker, never opaque.
				this.pixelRGBA(viewState, m.x * 2, m.y * 2, sx + sy, C, onion),
			);
		}

		const mapFocus = (px: number, py: number) => ({
			x: origin.x + (px - this.cam.x) * z,
			y: origin.y + (py - this.cam.y) * z,
		});
		const focusClip = { x0: RAIL_W, x1: RAIL_W + viewW, y0: top, y1: viewH };
		this.drawShapePreview(buf, mapFocus, focusClip, C);
		// The marquee tracks the active edit Frame only (onion sourcing already
		// gated `viewState` to it when editing).
		if (onion)
			this.drawSelectionMarquee(buf, viewState, mapFocus, focusClip, C);

		const bx = origin.x + (this.state.cursor.x - this.cam.x) * z;
		const by = origin.y + (this.state.cursor.y - this.cam.y) * z;
		this.drawCursorRing(
			buf,
			bx,
			by,
			{ x0: RAIL_W, x1: RAIL_W + viewW, y0: top, y1: viewH },
			(sx, sy) =>
				this.pixelRGBA(
					viewState,
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

		// Solve the small-terminal degradation ladder (spec #398) for this size.
		// Below the ≥80×24 floor the editor shows only a live placard — it never
		// exits and never touches state, so it recovers instantly on resize. Above
		// the floor the solver's rungs (preview auto-hide, forced focus, folded
		// playback) drive the layout below; the render layer only obeys them.
		const layout = solveDegradation({
			termW: W,
			termH: H,
			zoom: this.zoom,
			maxFrameCellW: this.maxFrameCellW(),
			frameCount: this.state.doc.frames.length,
			inkCount: this.entries().length + 1,
			previewOverride: this.previewOverride,
		});
		this.autoPreview = layout.previewAutoShow;
		this.forceFocus = layout.forceFocus;
		this.foldPlayback = layout.foldPlayback;
		this.focusHint = layout.focusHint;
		if (layout.placard !== null) {
			this.renderPlacard(buf, W, H, layout, C);
			return;
		}

		// The frame the canvas shows this instant (the edit frame, or the animated
		// frame during playback). cellAt only reads doc + frame name, so a shallow
		// state copy re-points it at the display frame without any mutation.
		const displayFrame = this.displayFrame;
		const viewState =
			displayFrame === this.state.frame
				? this.floatState()
				: { ...this.state, frame: displayFrame };

		// The canvas region sits right of the rail; the mirror panel, when toggled,
		// takes half of it with a one-column divider between. The Composited preview
		// no longer splits the canvas — it floats over the top-right (#393), so it is
		// drawn last, after the canvas and mirror.
		const rightPanel = this.mirror ? 'mirror' : 'none';
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
		// active — the strips grid is a poor movie screen. Rung 2 (spec #398) forces
		// focus when fewer than two Frames fit; the user's own view choice is kept
		// so growing the terminal back restores strips.
		const effectiveView =
			this.forceFocus && this.view === 'strips' ? 'focus' : this.view;
		if (this.playMode !== 'none') {
			this.renderFocus(buf, viewW, viewH, viewState, false, C);
		} else if (effectiveView === 'focus') {
			this.renderFocus(buf, viewW, viewH, viewState, true, C);
		} else {
			this.renderStrips(buf, viewW, viewH, C);
		}

		if (rightPanel === 'mirror') {
			this.renderMirror(buf, RAIL_W + viewW, W, viewH, displayFrame, C);
		}

		// The always-on floating Composited preview draws last, over the top-right of
		// whatever the canvas rendered (overlapping the first strip's corner is
		// accepted per the spec).
		this.geom.preview = null;
		if (this.composite) {
			this.renderPreviewPane(buf, W, viewH, displayFrame, C);
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
			animation: this.state.animation,
			anchorName: this.state.anchorName,
			anchorScope: this.state.anchorScope,
		});
		// The coercion note rides the right of the status row. Draw the composed
		// line, then re-tint just the note when it made the cut so it stands out.
		const feedback = this.state.feedback;
		const status = comanimationStatusLine(statusLeft, feedback, W);
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
					: `▶ playing ${this.state.animation} (${displayFrame}) — . or , stops`;
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
		} else if (this.focusHint) {
			// Rung 2's status hint (spec #398): tell the artist the strips folded to
			// focus and how to get them back.
			buf.drawText(this.focusHint.slice(0, W), 0, hintRow, C.hot, C.chromeBg);
		} else {
			const required = requiredHintLine(this.state.doc, this.role);
			const hints = hintLine(this.state.tool);
			const line = required ? `${required} ┃ ${hints}` : hints;
			buf.drawText(line.slice(0, W), 0, hintRow, C.dim, C.chromeBg);
		}

		this.renderHelp(buf, W, H, C);
		this.renderColorPicker(buf, W, H, C);
		this.renderAnimationMenu(buf, W, H, C);
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
		const previews = this.dynamicPreviews();
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
					previews,
				);
				const bg = resolveColorKey(
					bgKey === SENTINEL ? '' : bgKey,
					local,
					this.globalPalette,
					previews,
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
		// Mirrored anchor markers, reflected across the rendered width. Each keeps
		// the background its cell rendered without the marker — the art's bg key,
		// or the transparency checker where empty (QA round 3).
		for (const a of mirrorAnchorMarkers(anchorMarkers(this.state), m.width)) {
			if (a.x < 0 || a.x >= panelW || a.y < 0 || a.y >= viewH) continue;
			const glyph = m.rows[a.y]?.[a.x] ?? ' ';
			let cellBg: RGBA;
			if (glyph === ' ' || glyph === SENTINEL) {
				cellBg = (a.x + a.y) % 2 === 0 ? C.grid : C.bg;
			} else {
				const bgKey = m.bg[a.y]?.[a.x] ?? '';
				const bg = resolveColorKey(
					bgKey === SENTINEL ? '' : bgKey,
					local,
					this.globalPalette,
					previews,
				);
				cellBg = bg ? SpriteEditor.rgba(bg) : C.bg;
			}
			buf.setCell(
				ox + a.x,
				a.y,
				ANCHOR_MARKER,
				a.overridden ? C.overrideFg : C.anchorFg,
				cellBg,
			);
		}
	}

	// The always-on floating Composited preview (#393): a native-size, bordered pane
	// docked top-right over the canvas, drawn through the shared renderer
	// (`renderComposite`) — pixel-identical to the game. Shows the CURRENT display
	// frame: a hat on a body, a weapon in hand at its phase, a form wearing a hat +
	// weapon, or a monster/npc plain. Animates during playback because `frameName`
	// (the editor's display frame) advances with each tick. Carries flip + play
	// controls on its bottom border, both mouse-clickable; the pane's screen rect
	// and control spans are recorded in `geom.preview` for hit-testing.
	private renderPreviewPane(
		buf: OptimizedBuffer,
		W: number,
		viewH: number,
		frameName: string,
		C: Palette,
	): void {
		const paneW = Math.min(PREVIEW_W, W - RAIL_W);
		const paneH = Math.min(PREVIEW_H, viewH);
		// Too small to be legible: draw nothing (the ≥80×24 floor + degradation
		// ladder are #398; this only guards against a garbage draw).
		if (paneW < 10 || paneH < 5) return;
		const x0 = W - paneW;
		const y0 = 0;
		const x1 = x0 + paneW - 1;
		const y1 = y0 + paneH - 1;

		// Occlude the canvas beneath, then frame the pane so it reads as floating.
		buf.fillRect(x0, y0, paneW, paneH, C.boxBg);
		for (let x = x0; x <= x1; x++) {
			buf.setCell(x, y0, '─', C.divider, C.boxBg);
			buf.setCell(x, y1, '─', C.divider, C.boxBg);
		}
		for (let y = y0; y <= y1; y++) {
			buf.setCell(x0, y, '│', C.divider, C.boxBg);
			buf.setCell(x1, y, '│', C.divider, C.boxBg);
		}
		buf.setCell(x0, y0, '╭', C.divider, C.boxBg);
		buf.setCell(x1, y0, '╮', C.divider, C.boxBg);
		buf.setCell(x0, y1, '╰', C.divider, C.boxBg);
		buf.setCell(x1, y1, '╯', C.divider, C.boxBg);
		buf.drawText(' preview ', x0 + 2, y0, C.dim, C.boxBg);

		// Composite render into the interior, between the borders. Merge the doc's
		// file-local colours into the style so custom keys render faithfully (#393).
		const ix = x0 + 1;
		const iy = y0 + 1;
		const iw = paneW - 2;
		const ih = paneH - 2;
		const toRGBA = (r: number, g: number, b: number, a: number) =>
			RGBA.fromInts(r, g, b, a);
		// Merge the file-local colours, then the session dynamic variant (spec
		// #401 amendment): p/a keys that resolve through the style's palette now
		// carry the same colours the canvas and rail show, and the entity's hue
		// (below) recolors the body through the real game machinery.
		const previews = this.dynamicPreviews();
		const style = styleWithLocalColors(
			styleWithLocalColors(this.sceneStyle, this.state.doc.colors, toRGBA),
			{ p: previews.p, a: previews.a },
			toRGBA,
		);
		const region = new RegionBuffer(buf, ix, iy, iw, ih);
		// A live float tracks in the preview too: render the baked doc so the pane
		// shows the art exactly as a drop would commit it (spec #399).
		const previewDoc = floatDisplayDoc(this.state);
		const ok = renderComposite(region, previewDoc, this.role, style, {
			facing: this.previewFacing,
			// The display frame is a concrete frame name; the composite maps it to the
			// role-appropriate composition (weapon frame → swing phase, etc.).
			stance: frameName,
			elapsedS: 0,
			hue: this.variant.p,
		});
		if (!ok) buf.drawText('keep drawing…'.slice(0, iw), ix, iy, C.dim, C.bg);

		// Flip + play controls on the bottom border, clickable via geom.preview.
		const flipText = `flip ${this.previewFacing === 1 ? '→' : '←'}`;
		const playing = this.playMode !== 'none';
		const playText = playing ? '■ stop' : '▶ play';
		const flipX = x0 + 2;
		buf.drawText(flipText, flipX, y1, C.text, C.boxBg);
		const playX = flipX + flipText.length + 2;
		buf.drawText(playText, playX, y1, playing ? C.hot : C.text, C.boxBg);

		this.geom.preview = {
			x0,
			y0,
			w: paneW,
			h: paneH,
			flip: { x0: flipX, x1: flipX + flipText.length - 1, y: y1 },
			play: { x0: playX, x1: playX + playText.length - 1, y: y1 },
		};
	}

	// The below-floor placard (spec #398): a live centred "too small" notice shown
	// instead of the editor UI when the terminal drops under 80×24. Draws nothing
	// but this, mutates no state, and clears the stale geometry so a click on the
	// placard can't reach a canvas that isn't drawn — the editor recovers the
	// instant the terminal grows back.
	private renderPlacard(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		layout: DegradationLayout,
		C: Palette,
	): void {
		this.geom.viewH = 0;
		this.geom.viewW = 0;
		this.geom.layout = null;
		this.geom.focus = null;
		this.geom.preview = null;
		buf.fillRect(0, 0, W, H, C.bg);
		const text = layout.placard ?? '';
		const row = Math.floor((H - 1) / 2);
		const col = Math.max(0, Math.floor((W - text.length) / 2));
		buf.drawText(text.slice(0, W), col, row, C.hot, C.bg);
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

	// The `e` file-local colour picker modal (spec #387, #401): a hue/shade swatch
	// grid plus a hex line, over a centred box. The selected cell is marked and the
	// composed colour swatched next to the hex echo. The grid's screen rect is
	// recorded in `geom.colorGrid` so a click resolves to a cell.
	private renderColorPicker(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		C: Palette,
	): void {
		this.geom.colorGrid = null;
		const p = this.colorPicker;
		if (!p) return;
		const cellW = 2;
		const cellH = 1;
		const gridW = HUE_COLS * cellW;
		const title =
			p.mode === 'edit'
				? `Edit file-local colour '${p.key}'`
				: `Define file-local colour '${p.key}'`;
		const hexLine = `hex #${p.hex.padEnd(6, '_')}`;
		const hint = 'arrows/click grid · type hex · enter save · esc';
		const contentW = Math.max(
			gridW,
			title.length,
			hexLine.length + 3,
			hint.length,
		);
		const boxW = Math.min(W, contentW + 2);
		const bodyRows = 1 + SHADE_ROWS + 1 + (p.error ? 1 : 0) + 1;
		const boxH = Math.min(H, bodyRows);
		const ox = Math.max(0, Math.floor((W - boxW) / 2));
		const oy = Math.max(0, Math.floor((H - boxH) / 2));
		buf.fillRect(ox, oy, boxW, boxH, C.boxBg);

		let y = oy;
		buf.drawText(title.slice(0, boxW), ox + 1, y, C.text, C.boxBg);
		y += 1;
		const gx = ox + 1;
		const gy = y;
		this.geom.colorGrid = { x0: gx, y0: gy, cellW, cellH };
		for (let row = 0; row < SHADE_ROWS; row++) {
			for (let col = 0; col < HUE_COLS; col++) {
				const color = SpriteEditor.rgba(gridColor(col, row));
				const sel = col === p.col && row === p.row;
				const sx = gx + col * cellW;
				for (let dx = 0; dx < cellW; dx++)
					buf.setCell(
						sx + dx,
						gy + row * cellH,
						sel && dx === 0 ? '▸' : ' ',
						C.cursorFg,
						color,
					);
			}
		}
		y = gy + SHADE_ROWS * cellH;
		buf.drawText(hexLine.slice(0, boxW), ox + 1, y, C.text, C.boxBg);
		const swatch = SpriteEditor.rgba(p.rgba);
		const swx = ox + 1 + hexLine.length + 1;
		if (swx + 1 < ox + boxW) {
			buf.setCell(swx, y, ' ', C.text, swatch);
			buf.setCell(swx + 1, y, ' ', C.text, swatch);
		}
		y += 1;
		if (p.error) {
			buf.drawText(
				`⚠ ${p.error}`.slice(0, boxW),
				ox + 1,
				y,
				C.feedback,
				C.boxBg,
			);
			y += 1;
		}
		buf.drawText(hint.slice(0, boxW), ox + 1, y, C.dim, C.boxBg);
	}

	// A centered modal box from pre-formatted rows; a row beginning with '▸' is
	// highlighted. Shared by the picker, the animation/anchor menus and the help
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

	private renderAnimationMenu(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		C: Palette,
	): void {
		const menu = this.animationMenu;
		if (!menu) return;
		const rows: string[] = [];
		if (menu.input) {
			const title =
				menu.input.mode === 'create' ? 'New animation name' : 'Animation fps';
			rows.push(title);
			rows.push(`▸ ${menu.input.buffer || '_'}`);
			if (menu.error) rows.push(`⚠ ${menu.error}`);
			rows.push('Enter confirm · Esc back');
		} else {
			rows.push('Animations');
			for (let i = 0; i < menu.animations.length; i++) {
				const p = menu.animations[i];
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
	let initialFeedback: string | undefined;

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
		// Whole-file sizing (spec #402): a file whose Frames differ in size is
		// normalized to the union bbox on load, so the editor's whole-file resize/
		// crop operate on uniform Frames. Passing the normalized doc as the saved
		// baseline keeps a freshly-loaded uniform file from reading as dirty.
		doc = normalizeDoc(parsed.doc);
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
		// Surface the fresh-template open in the status line: a load that failed
		// to resolve a file must never silently masquerade as an existing sprite.
		initialFeedback = `creating new sprite ${dirForRole(role)}/${target.id}`;
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
		initialFeedback,
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
