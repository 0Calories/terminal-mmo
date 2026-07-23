import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RGBAQuad } from '@mmo/core/entities';
import { STANDARD_PALETTE } from '@mmo/core/entities';
import {
	allFrames,
	frameLocations,
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
import { encodeSurface } from '../render/compositor-encode';
import { findSpriteFile, formatSpriteDiagnostics } from '../sprite-cli';
import {
	type CanvasModal,
	canvasTarget,
	isClipped,
	nudgeCanvasEdge,
	openCanvasModal,
	setEdge,
} from './canvasModal';
import {
	helpOverlayRows,
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
import {
	baseCompositeStyle,
	type CompositeStyle,
	renderComposite,
	renderPlainFrame,
	styleWithLocalColors,
} from './composite';
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
	createDoubleClickDetector,
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
	anchorMenuClick,
	anchorMenuKey,
	animationMenuKey,
	type MenuKey,
	openAnchorMenu,
	openAnimationMenu,
	syncAnimationMenu,
} from './menus';
import { ghostColor, previousGhostFrame } from './onion';
import { animationFps, playbackFrame, walkPreviewIndex } from './playback';
import type { ResizeEdge } from './resize';
import { normalizeDoc } from './resize';
import {
	anchorMarkers,
	anchorScopeFor,
	animationFrames,
	beginStroke,
	cancelFloat,
	cancelShape,
	cellAt,
	clearSelection,
	cloneFrameToAnimation,
	colorInk,
	commitFloat,
	copySelection,
	createAnimation,
	currentFrame,
	cutSelection,
	type DynamicPreviews,
	defineLocalColor,
	deleteAnchor,
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
	pendingSelectionRect,
	pixelToCell,
	placeAnchor,
	readPixel,
	redoEdit,
	removeAnchorOverride,
	reorderFrame,
	resizeCanvas,
	type SpriteEditorState,
	type SpriteTool,
	saveResult,
	selectAll,
	selectAnimation,
	selectFrame,
	selectionOverlay,
	setAnchorName,
	setAnimationFps,
	setInk,
	setTool,
	shapePreviewPixels,
	stampGlyph,
	toggleShapeMode,
	undoEdit,
} from './state';
import {
	centeredOrigin,
	clampScroll,
	type FocusTab,
	FPS_MAX,
	FPS_MIN,
	focusTabAt,
	focusTabs,
	frameBoxOf,
	type StripsLayout,
	scrollIntoView,
	stepperHit,
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
	docDynamicUsage,
	missingRequiredAnchors,
	parseEditArg,
	requiredAnchors,
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

export interface SpriteKey {
	name: string;
	sequence?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
	super?: boolean;
	option?: boolean;
}

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

	save: (text: string) => void;
	onQuit?: () => void;
	initialDiags?: readonly SpriteDiagnostic[];
	globalPalette?: Readonly<Record<string, RGBAQuad>>;

	initialFeedback?: string;

	now?: () => number;
}

const CHROME_H = CHROME_ROWS;

export const RENDERER_CLEAR_COLOR = '#05060a';

function variantRowCountOf(options: readonly { channel: 'p' | 'a' }[]): number {
	return new Set(options.map((o) => o.channel)).size;
}
const SCROLLOFF = 2;

const FILMSTRIP_GAP = 2;

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

type PlayMode = 'none' | 'animation' | 'walk';

type CanvasView = 'strips' | 'focus';

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

	colorPicker: ColorPickerState | null = null;

	animationMenu: AnimationMenuState | null = null;
	anchorMenu: AnchorMenuState | null = null;

	canvasModal: CanvasModal | null = null;

	private canvasDragEdges: ResizeEdge[] | null = null;

	previewOverride: boolean | null = null;
	private autoPreview = true;

	private forceFocus = false;
	private foldPlayback = false;
	private focusHint = '';

	get composite(): boolean {
		return previewVisible(this.autoPreview, this.previewOverride);
	}

	previewFacing: 1 | -1 = 1;

	view: CanvasView = 'strips';

	helpOpen = false;
	private readonly sceneStyle: CompositeStyle;
	awaitingStamp = false;

	playMode: PlayMode = 'none';
	private playElapsedMs = 0;

	private variant = { p: 0, a: 0 };
	private penDown = false;

	zoom = DEFAULT_ZOOM;

	onion = false;
	private onionLayers: {
		read: (px: number, py: number) => boolean;
		color: RGBA;
	}[] = [];

	private cam: Cam = { x: 0, y: 0 };

	private scroll = { x: 0, y: 0 };

	private followCursor = true;

	private panLast: { x: number; y: number } | null = null;

	private anchorDrag: {
		name: string;
		cell: { x: number; y: number } | null;
	} | null = null;

	private isSwatchDoubleClick: (x: number, y: number) => boolean;
	private panRem = { x: 0, y: 0 };

	private geom: {
		viewH: number;

		viewW: number;
		rail: readonly RailRow[];
		layout: StripsLayout | null;
		focus: {
			tabs: readonly FocusTab[];
			origin: { x: number; y: number };
			top: number;

			frames: { name: string; x0: number; x1: number }[];

			pxH: number;

			plusTile: { x0: number; x1: number; y0: number; y1: number } | null;

			onionToggle: { x0: number; x1: number; y: number } | null;
		} | null;

		preview: {
			x0: number;
			y0: number;
			w: number;
			h: number;
			flip: { x0: number; x1: number; y: number };
			play: { x0: number; x1: number; y: number };
		} | null;

		colorGrid: {
			x0: number;
			y0: number;
			cellW: number;
			cellH: number;
		} | null;

		anchorCells: { x: number; y: number; name: string; overridden: boolean }[];

		anchorMenuBox: { ox: number; oy: number; w: number; h: number } | null;

		canvasModal: {
			ox0: number;
			oy0: number;
			cw: number;
			ch: number;
			leftX: number;
			rightX: number;
			topY: number;
			bottomY: number;
			box: { ox: number; oy: number; w: number; h: number };
		} | null;
	} = {
		viewH: 0,
		viewW: 0,
		rail: [],
		layout: null,
		focus: null,
		preview: null,
		colorGrid: null,
		anchorCells: [],
		anchorMenuBox: null,
		canvasModal: null,
	};

	private mouseStroke = false;
	private mouseButton: RawMouse['button'] = 'left';

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

		this.globalPalette = opts.globalPalette ?? STANDARD_PALETTE;
		this.isSwatchDoubleClick = createDoubleClickDetector(opts.now ?? Date.now);
		this.sceneStyle = baseCompositeStyle();

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

	private dynamicPreviews(): DynamicPreviews {
		return variantPreviews(this.variant.p, this.variant.a);
	}

	private maxFrameCellW(): number {
		return Math.max(
			1,
			...allFrames(this.state.doc).map((f) => frameExtent(f).w),
		);
	}

	private liftPen(): void {
		if (this.penDown) {
			this.state = endStroke(this.state);
			this.penDown = false;
		}
	}

	private applyAtCursor(): void {
		const { x, y } = this.state.cursor;

		const paint: KeyPaint = this.state.tool === 'erase' ? 'transparent' : 'ink';
		this.state = applyInput(
			this.state,
			normalizeKey({ pixel: { x, y }, paint }),
		);
	}

	private primary(): void {
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

		if (
			this.state.tool === 'move' &&
			(this.state.float || this.state.selection)
		) {
			this.state = nudgeFloat(this.state, dx, dy);
			return;
		}

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

	private setZoom(z: number): void {
		this.liftPen();
		this.zoom = z;
	}

	private modalActive(): boolean {
		return (
			this.colorPicker !== null ||
			this.animationMenu !== null ||
			this.anchorMenu !== null ||
			this.awaitingStamp ||
			this.helpOpen ||
			this.canvasModal !== null
		);
	}

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
				if (
					action.tool === this.state.tool &&
					(action.tool === 'rect' || action.tool === 'ellipse')
				) {
					this.liftPen();
					this.state = toggleShapeMode(this.state);
					return;
				}
				this.switchTool(action.tool);
				return;
			case 'ink':
				this.liftPen();
				this.state = setInk(this.state, action.ink);
				return;
			case 'play':
				this.togglePlay(action.mode);
				return;
			case 'animationMenu':
				this.openAnimationMenu();
				return;
			case 'anchorMenu':
				this.openAnchorMenu();
				return;
			case 'canvas':
				this.openCanvasSizeModal();
				return;
			case 'previewToggle':
				this.togglePreview();
				return;
			case 'variant':
				this.variant = { ...this.variant, [action.channel]: action.index };
				return;
		}
	}

	private stripsContentAt(e: { x: number; y: number }): {
		cx: number;
		cy: number;
	} {
		return {
			cx: e.x - RAIL_W + this.scroll.x,
			cy: e.y + this.scroll.y,
		};
	}

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

	private dismissSaveNotice(): void {
		this.saved = false;
	}

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

	private canvasDown(button: 'left' | 'right', e: SpriteMouse): void {
		if (this.playMode !== 'none') return;

		const marker = this.geom.anchorCells.find(
			(m) => m.x === e.x && m.y === e.y,
		);
		if (marker) {
			if (button === 'left') {
				this.liftPen();
				this.anchorDrag = { name: marker.name, cell: null };
				return;
			}
			if (marker.overridden) {
				this.liftPen();
				this.state = removeAnchorOverride(this.state, marker.name);
				return;
			}
		}
		let px: { x: number; y: number } | null = null;

		if (this.geom.layout) {
			const layout = this.geom.layout;
			const { cx, cy } = this.stripsContentAt(e);
			const hit = stripsHit(layout, cx, cy);
			if (!hit) {
				const step = stepperHit(layout, cx, cy);
				if (step && button === 'left') {
					this.liftPen();
					const cur = animationFps(this.state.doc, step.animation);
					const next = Math.max(FPS_MIN, Math.min(FPS_MAX, cur + step.delta));
					if (next !== cur)
						this.state = setAnimationFps(this.state, step.animation, next);
					return;
				}

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

			if (hit.frame.name !== this.state.frame)
				this.state = selectFrame(this.state, hit.frame.name);
			px = { x: hit.px, y: hit.py };
		} else {
			const f = this.geom.focus;
			if (f && e.y < f.top) {
				const ot = f.onionToggle;
				if (ot && e.y === ot.y && e.x >= ot.x0 && e.x <= ot.x1) {
					this.liftPen();
					this.toggleOnion();
					return;
				}
				const tab = focusTabAt(f.tabs, e.x - RAIL_W);
				if (tab) this.state = selectFrame(this.state, tab.name);
				return;
			}

			if (
				f?.plusTile &&
				e.x >= f.plusTile.x0 &&
				e.x <= f.plusTile.x1 &&
				e.y >= f.plusTile.y0 &&
				e.y < f.plusTile.y1
			) {
				this.liftPen();
				this.state = cloneFrameToAnimation(this.state, this.state.animation);
				this.followCursor = true;
				return;
			}

			if (f) {
				const inRow = e.y >= f.origin.y && e.y < f.origin.y + f.pxH * this.zoom;
				const box = inRow
					? f.frames.find((b) => e.x >= b.x0 && e.x < b.x1)
					: undefined;
				if (box && box.name !== this.state.frame) {
					this.liftPen();
					this.state = selectFrame(this.state, box.name);
					return;
				}
				if (!box) return;
			}
			px = this.focusPixel(e.x, e.y);
		}
		if (!px) return;

		if (e.modifiers?.alt) {
			this.paintMouse(button, px, e.modifiers);
			return;
		}

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

		if (this.state.float) this.state = commitFloat(this.state);

		if (this.state.tool === 'fill') {
			this.paintMouse(button, px, e.modifiers);
			return;
		}
		if (this.state.tool === 'anchor') {
			if (button === 'left') {
				this.state = moveCursor(this.state, px.x, px.y);
				this.placeAnchorAtCursor();
			}
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

		if (this.colorPicker) {
			if (e.button === 0) this.colorPickerClick(e);
			return;
		}

		if (this.anchorMenu) {
			const box = this.geom.anchorMenuBox;
			if (e.button === 0 && box && !this.anchorMenu.input) {
				const inside =
					e.x >= box.ox &&
					e.x < box.ox + box.w &&
					e.y >= box.oy &&
					e.y < box.oy + box.h;
				if (inside) {
					const row = e.y - box.oy - 1;
					const deleteZone = e.x >= box.ox + box.w - 3;
					const res = anchorMenuClick(this.anchorMenu, row, deleteZone);
					this.anchorMenu = res.menu;
					if (res.action) this.applyAnchorAction(res.action);
				}
			}
			return;
		}

		if (this.canvasModal) {
			if (e.button === 0) this.canvasModalDown(e);
			return;
		}
		if (this.modalActive()) return;

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

		if (e.button === 1) {
			this.panLast = { x: e.x, y: e.y };
			return;
		}
		const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'none';
		if (button === 'none') return;
		if (e.y >= this.geom.viewH) return;
		if (e.x < RAIL_W) {
			const action = railActionAt(this.geom.rail, e.x, e.y);

			if (
				action?.type === 'ink' &&
				button === 'left' &&
				this.isSwatchDoubleClick(e.x, e.y)
			) {
				this.applyRail(action);
				this.openColorPickerModal();
				return;
			}
			if (action) this.applyRail(action);
			return;
		}
		this.canvasDown(button, e);
	}

	mouseDrag(e: SpriteMouse): void {
		if (this.canvasDragEdges && this.canvasModal) {
			this.canvasModal = this.canvasDragTo(
				this.canvasModal,
				this.canvasDragEdges,
				e.x,
				e.y,
			);
			return;
		}
		if (this.panLast) {
			this.pan(e.x - this.panLast.x, e.y - this.panLast.y);
			this.panLast = { x: e.x, y: e.y };
			return;
		}

		if (this.anchorDrag) {
			const px = this.dragPixelAt(e);
			if (px) {
				const { cellX, cellY } = pixelToCell(px.x, px.y);
				this.anchorDrag = {
					name: this.anchorDrag.name,
					cell: { x: cellX, y: cellY },
				};
			}
			return;
		}
		if (!this.mouseStroke && !this.mouseShape) return;

		const px = this.dragPixelAt(e);
		if (!px) return;
		if (this.mouseShape) {
			this.shapePx = px;
			this.shapeMouse('drag', this.mouseButton, px, e.modifiers);
			return;
		}
		this.paintMouse(this.mouseButton, px, e.modifiers);
	}

	private dragPixelAt(e: { x: number; y: number }): {
		x: number;
		y: number;
	} | null {
		if (this.geom.layout) {
			const { cx, cy } = this.stripsContentAt(e);
			const hit = stripsHit(this.geom.layout, cx, cy);
			if (!hit || hit.frame.name !== this.state.frame) return null;
			return { x: hit.px, y: hit.py };
		}
		return this.focusPixel(e.x, e.y);
	}

	mouseUp(_e?: unknown): void {
		this.panLast = null;

		if (this.canvasDragEdges) {
			this.canvasDragEdges = null;
			return;
		}
		if (this.anchorDrag) {
			const { name, cell } = this.anchorDrag;
			this.anchorDrag = null;
			if (cell) this.state = placeAnchor(this.state, name, cell.x, cell.y);
			return;
		}
		if (this.mouseShape) {
			this.shapeMouse('up', this.mouseButton, this.shapePx);
			this.mouseShape = false;
		}
		if (this.mouseStroke) {
			this.state = endStroke(this.state);
			this.mouseStroke = false;
		}
	}

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

		const z = this.zoom;
		const step = (d: number) =>
			d === 0 ? 0 : Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / z));
		this.cam = {
			x: Math.max(0, this.cam.x + step(route.dx)),
			y: Math.max(0, this.cam.y + step(route.dy)),
		};
	}

	private openColorPickerModal(): void {
		this.liftPen();
		this.colorPicker = openColorPicker(
			this.state,
			Object.keys(this.globalPalette),
		);
	}

	private applyColorPickerAction(action: ColorPickerAction): void {
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

		const ch = k.sequence ?? '';
		if (ch.length === 1) this.colorPicker = typeHex(p, ch);
	}

	private colorPickerClick(e: SpriteMouse): void {
		const p = this.colorPicker;
		const g = this.geom.colorGrid;
		if (!p || !g) return;
		const col = Math.floor((e.x - g.x0) / g.cellW);
		const row = Math.floor((e.y - g.y0) / g.cellH);
		if (col < 0 || col >= HUE_COLS || row < 0 || row >= SHADE_ROWS) return;
		this.colorPicker = pickCell(p, col, row);
	}

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

		if (this.state.float) this.state = commitFloat(this.state);

		if (tool === 'paste') {
			this.state = pasteFromClipboard(setTool(this.state, 'move'));
			this.followCursor = true;
			return;
		}
		this.state = setTool(this.state, tool);
	}

	private animationRows(): AnimationRow[] {
		return this.state.doc.animations.map((a) => ({
			name: a.name,
			frameCount: a.frames.length,
			fps: a.fps ?? null,
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
			case 'play':
				break;
			case 'close':
				break;
		}
	}

	private animationMenuKeyDispatch(k: SpriteKey): void {
		const menu = this.animationMenu;
		if (!menu) return;
		const res = animationMenuKey(menu, toMenuKey(k));

		if (res.action?.type === 'play') {
			this.animationMenu = null;
			if (res.action.mode === 'animation')
				this.state = selectAnimation(this.state, res.action.animation);
			if (this.playMode !== res.action.mode) this.togglePlay(res.action.mode);
			return;
		}
		if (res.action && res.action.type !== 'close') {
			const keep = res.action.type === 'create' ? res.action.name : undefined;
			this.applyAnimationAction(res.action);

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

	private anchorCandidates(): string[] {
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
			requiredAnchors(this.role),
		);
	}

	private applyAnchorAction(action: AnchorMenuAction): void {
		if (action.type === 'select') {
			this.state = setAnchorName(this.state, action.name);
			this.state = setTool(this.state, 'anchor');
		}
		if (action.type === 'delete') {
			this.state = deleteAnchor(
				this.state,
				action.name,
				requiredAnchors(this.role),
			);

			if (this.anchorMenu)
				this.anchorMenu = openAnchorMenu(
					this.anchorCandidates(),
					this.state.anchorName,
					requiredAnchors(this.role),
				);
		}
	}

	private anchorMenuKeyDispatch(k: SpriteKey): void {
		const menu = this.anchorMenu;
		if (!menu) return;
		const res = anchorMenuKey(menu, toMenuKey(k));
		this.anchorMenu = res.menu;
		if (res.action) this.applyAnchorAction(res.action);
	}

	private displayMarkers(): ReturnType<typeof anchorMarkers> {
		const markers = anchorMarkers(this.state);
		const d = this.anchorDrag;
		if (!d?.cell) return markers;
		const cell = d.cell;
		return markers.map((m) =>
			m.name === d.name ? { ...m, x: cell.x, y: cell.y } : m,
		);
	}

	private placeAnchorAtCursor(): void {
		const { cellX, cellY } = pixelToCell(
			this.state.cursor.x,
			this.state.cursor.y,
		);
		if (!this.state.anchorName) {
			this.state = {
				...this.state,
				feedback: 'pick an anchor first (rail: anchor)',
			};
			return;
		}
		this.state = placeAnchor(this.state, this.state.anchorName, cellX, cellY);
	}

	private openCanvasSizeModal(): void {
		this.liftPen();
		this.state = { ...this.state, shape: null, float: null, selection: null };
		this.canvasModal = openCanvasModal(this.state.doc);
	}

	private canvasModalKey(k: SpriteKey): void {
		const m = this.canvasModal;
		if (!m) return;
		if (k.name === 'escape') {
			this.canvasModal = null;
			return;
		}
		if (k.name === 'return' || k.name === 'enter') {
			this.state = resizeCanvas(this.state, m);
			this.canvasModal = null;
			this.followCursor = true;
			return;
		}
		const dir = this.canvasArrowDir(m.edge, k.name);
		if (dir !== 0) this.canvasModal = nudgeCanvasEdge(m, dir);
	}

	private canvasArrowDir(
		edge: ResizeEdge,
		name: string | undefined,
	): 1 | -1 | 0 {
		switch (edge) {
			case 'left':
				if (name === 'left' || name === 'a') return 1;
				if (name === 'right' || name === 'd') return -1;
				return 0;
			case 'right':
				if (name === 'right' || name === 'd') return 1;
				if (name === 'left' || name === 'a') return -1;
				return 0;
			case 'top':
				if (name === 'up' || name === 'w') return 1;
				if (name === 'down' || name === 's') return -1;
				return 0;
			default:
				if (name === 'down' || name === 's') return 1;
				if (name === 'up' || name === 'w') return -1;
				return 0;
		}
	}

	private canvasModalDown(e: SpriteMouse): void {
		const g = this.geom.canvasModal;
		const m = this.canvasModal;
		if (!g || !m) return;
		const tol = 1;
		const onY = e.y >= g.topY - tol && e.y <= g.bottomY + tol;
		const onX = e.x >= g.leftX - tol && e.x <= g.rightX + tol;
		const edges: ResizeEdge[] = [];
		if (onY && Math.abs(e.x - g.leftX) <= tol) edges.push('left');
		if (onY && Math.abs(e.x - g.rightX) <= tol) edges.push('right');
		if (onX && Math.abs(e.y - g.topY) <= tol) edges.push('top');
		if (onX && Math.abs(e.y - g.bottomY) <= tol) edges.push('bottom');
		if (edges.length === 0) return;
		this.canvasDragEdges = edges;
		this.canvasModal = this.canvasDragTo(m, edges, e.x, e.y);
	}

	private canvasDragTo(
		m: CanvasModal,
		edges: readonly ResizeEdge[],
		x: number,
		y: number,
	): CanvasModal {
		const g = this.geom.canvasModal;
		if (!g) return m;
		let next = m;
		for (const edge of edges) {
			if (edge === 'left')
				next = setEdge(next, 'left', -Math.round((x + 1 - g.ox0) / g.cw));
			else if (edge === 'right')
				next = setEdge(next, 'right', Math.round((x - g.ox0) / g.cw) - m.w0);
			else if (edge === 'top')
				next = setEdge(next, 'top', -Math.round((y + 1 - g.oy0) / g.ch));
			else
				next = setEdge(next, 'bottom', Math.round((y - g.oy0) / g.ch) - m.h0);
		}
		return next;
	}

	private stepFocusFrame(delta: number): void {
		const frames = animationFrames(this.state, this.state.animation);
		if (frames.length <= 1) return;
		const i = frames.indexOf(this.state.frame);
		if (i < 0) return;
		const n = frames.length;
		const next = frames[(i + delta + n) % n];
		this.liftPen();
		this.state = selectFrame(this.state, next);
		this.followCursor = true;
	}

	private togglePlay(mode: 'animation' | 'walk'): void {
		this.liftPen();
		this.playMode = this.playMode === mode ? 'none' : mode;
		this.playElapsedMs = 0;
	}

	private togglePreview(): void {
		this.previewOverride = !this.composite;
	}

	private toggleOnion(): void {
		this.onion = !this.onion;
		this.state = {
			...this.state,
			feedback: this.onion ? 'onion skin on' : 'onion skin off',
		};
	}

	tick(deltaMs: number): void {
		if (this.playMode === 'none') return;
		this.playElapsedMs += deltaMs;
		this.requestRender();
	}

	get playing(): boolean {
		return this.playMode !== 'none';
	}

	get displayFrame(): string {
		if (this.playMode === 'walk') {
			const frames = animationFrames(this.state, 'walk');
			const idx = walkPreviewIndex(frames.length, this.playElapsedMs / 1000);
			return frames[idx] ?? this.state.frame;
		}
		if (this.playMode === 'animation') {
			const frames = animationFrames(this.state, this.state.animation);
			if (frames.length === 0) return this.state.frame;
			const fps = animationFps(this.state.doc, this.state.animation);
			const idx = playbackFrame(frames.length, this.playElapsedMs / 1000, fps);
			return frames[idx] ?? this.state.frame;
		}
		return this.state.frame;
	}

	private floatState(): SpriteEditorState {
		if (!this.state.float) return this.state;
		return { ...this.state, doc: floatDisplayDoc(this.state) };
	}

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

		if (this.canvasModal) {
			this.canvasModalKey(k);
			return;
		}
		if (k.sequence === '?') {
			this.liftPen();
			this.helpOpen = true;
			return;
		}

		if (this.playMode !== 'none') {
			if (k.name === 'q') {
				this.onQuit?.();
				return;
			}
			if (k.name === 'escape') {
				this.togglePlay(this.playMode);
				return;
			}
			this.state = {
				...this.state,
				feedback: 'playback active — esc or click ▶ to stop',
			};
			return;
		}

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

		if (
			(k.name === 'return' || k.name === 'enter') &&
			this.state.float &&
			this.state.tool !== 'move'
		) {
			this.liftPen();
			this.state = commitFloat(this.state);
			return;
		}

		if (k.name === 'delete' || k.name === 'backspace') {
			this.liftPen();
			this.state = deleteSelection(this.state);
			return;
		}

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

		if (k.sequence === '+' || k.sequence === '=') {
			this.setZoom(stepZoom(this.zoom, 1));
			return;
		}
		if (k.sequence === '-' || k.name === 'minus') {
			this.setZoom(stepZoom(this.zoom, -1));
			return;
		}
		if (k.name === 'tab') {
			this.toggleView();
			return;
		}

		const inFocus =
			this.view === 'focus' || (this.forceFocus && this.view === 'strips');
		const arrowsBusy =
			this.state.shape !== null ||
			this.state.float !== null ||
			(this.state.tool === 'move' && this.state.selection !== null);
		if (
			inFocus &&
			!k.shift &&
			(k.name === 'left' || k.name === 'right') &&
			!arrowsBusy
		) {
			this.stepFocusFrame(k.name === 'left' ? -1 : 1);
			return;
		}

		const railTool = RAIL_TOOLS.find((t) => k.sequence === t.key);
		if (railTool) {
			this.switchTool(railTool.tool);
			return;
		}

		switch (k.name) {
			case 'left':
			case 'a':
				this.move(-1, 0);
				return;
			case 'right':
			case 'd':
				this.move(1, 0);
				return;
			case 'up':
			case 'w':
				this.move(0, -1);
				return;
			case 'down':
			case 's':
				this.move(0, 1);
				return;
			case 'space':
				this.primary();
				return;
			case 'return':
			case 'enter':
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
			case 'q':
				this.onQuit?.();
				return;
		}
	}

	private static rgba(q: RGBAQuad): RGBA {
		return RGBA.fromInts(q[0], q[1], q[2], q[3]);
	}

	private buildOnionLayers(C: Palette): void {
		if (this.playMode !== 'none' || !this.onion) {
			this.onionLayers = [];
			return;
		}
		const frames = animationFrames(this.state, this.state.animation);
		const prev = previousGhostFrame(frames, this.state.frame);
		if (!prev) {
			this.onionLayers = [];
			return;
		}
		const bg = C.bg.toInts();
		const ghostState: SpriteEditorState = { ...this.state, frame: prev };
		this.onionLayers = [
			{
				read: (px: number, py: number) => readPixel(ghostState, px, py),
				color: SpriteEditor.rgba(ghostColor('prev', 1, bg)),
			},
		];
	}

	private onionGhostRGBA(px: number, py: number): RGBA | null {
		for (const layer of this.onionLayers)
			if (layer.read(px, py)) return layer.color;
		return null;
	}

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

		if (onion) {
			const ghost = this.onionGhostRGBA(px, py);
			if (ghost) return ghost;
		}
		return phase % 2 === 0 ? C.grid : C.bg;
	}

	private dimRGBA(c: RGBA, C: Palette): RGBA {
		const [r, g, b] = c.toInts();
		const [br, bg, bb] = C.bg.toInts();
		const f = 0.5;
		return RGBA.fromInts(
			Math.round(r * (1 - f) + br * f),
			Math.round(g * (1 - f) + bg * f),
			Math.round(b * (1 - f) + bb * f),
			255,
		);
	}

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

	private drawShapePreview(
		buf: OptimizedBuffer,
		mapPx: (px: number, py: number) => { x: number; y: number },
		clip: { x0: number; x1: number; y0: number; y1: number },
		C: Palette,
	): void {
		if (!this.state.shape) return;

		const pending = pendingSelectionRect(this.state);
		if (pending) {
			this.drawMarqueeRing(
				buf,
				pending,
				this.state,
				mapPx,
				clip,
				C.anchorFg,
				C,
			);
			return;
		}
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

	private drawSelectionMarquee(
		buf: OptimizedBuffer,
		disp: SpriteEditorState,
		mapPx: (px: number, py: number) => { x: number; y: number },
		clip: { x0: number; x1: number; y0: number; y1: number },
		C: Palette,
	): void {
		const sel = selectionOverlay(this.state);
		if (!sel) return;
		const marquee = this.state.float ? C.hot : C.anchorFg;
		this.drawMarqueeRing(buf, sel, disp, mapPx, clip, marquee, C);
	}

	private drawMarqueeRing(
		buf: OptimizedBuffer,
		sel: { x0: number; y0: number; x1: number; y1: number },
		disp: SpriteEditorState,
		mapPx: (px: number, py: number) => { x: number; y: number },
		clip: { x0: number; x1: number; y0: number; y1: number },
		color: RGBA,
		C: Palette,
	): void {
		const z = this.zoom;
		for (let py = sel.y0; py <= sel.y1; py++)
			for (let px = sel.x0; px <= sel.x1; px++) {
				const border =
					px === sel.x0 || px === sel.x1 || py === sel.y0 || py === sel.y1;
				if (!border) continue;
				const o = mapPx(px, py);
				const under = this.pixelRGBA(disp, px, py, px + py, C, false);
				for (let dy = 0; dy < z; dy++)
					for (let dx = 0; dx < z; dx++) {
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
						buf.setCell(sx, sy, '·', color, under);
					}
			}
	}

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

	private renderRail(buf: OptimizedBuffer, viewH: number, C: Palette): void {
		buf.fillRect(0, 0, RAIL_W - 1, viewH, C.chromeBg);
		for (let y = 0; y < viewH; y++)
			buf.setCell(RAIL_W - 1, y, '│', C.divider, C.bg);
		const rows = railModel({
			tool: this.state.tool,
			ink: this.state.ink,
			entries: this.entries(),
			animation: this.state.animation,
			fps: animationFps(this.state.doc, this.state.animation),
			frameCount: animationFrames(this.state, this.state.animation).length,
			playMode: this.playMode,
			height: viewH,
			foldPlayback: this.foldPlayback,
			variants: variantOptions(docDynamicUsage(this.state.doc), this.variant),
			previewOn: this.composite,
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

						this.pixelRGBA(st, px, py, cx + cy, C, false),
					);
				}
			}
		}

		const defaultFrame = frameLocations(this.state.doc)[0]?.label;
		layout.labels.forEach((label, i) => {
			const sy = syOf(layout.nameRows[i]);
			if (sy < 0 || sy >= viewH) return;
			for (const box of layout.frames) {
				if (box.animation !== label.animation) continue;
				const active = box.name === this.state.frame;

				const display = `frame ${box.index}`;
				const name = box.name === defaultFrame ? `◈${display}` : display;
				const text = active
					? (name + '▔'.repeat(Math.max(0, box.w - name.length))).slice(
							0,
							Math.max(box.w, name.length),
						)
					: name;
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

		for (const st of layout.steppers) {
			const sy = syOf(st.y);
			if (sy < 0 || sy >= viewH) continue;
			this.drawClipped(buf, st.text, sxOf(st.x), sy, x0, x1, C.dim, C.bg);
		}

		const activeBox = frameBoxOf(layout, this.state.frame);
		if (!activeBox) return;

		for (const m of this.displayMarkers()) {
			const ccx = activeBox.x + m.x * 2 * z;
			const ccy = activeBox.y + m.y * 2 * z;
			const sx = sxOf(ccx);
			const sy = syOf(ccy);
			if (sx < x0 || sx >= x1 || sy < 0 || sy >= viewH) continue;
			this.geom.anchorCells.push({
				x: sx,
				y: sy,
				name: m.name,
				overridden: m.overridden,
			});
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? C.overrideFg : C.anchorFg,
				this.pixelRGBA(disp, m.x * 2, m.y * 2, ccx + ccy, C, false),
			);
		}

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
					false,
				),
			C,
		);
	}

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

		let onionToggle: { x0: number; x1: number; y: number } | null = null;
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

			if (frames.length > 1) {
				const onionText = '◌ onion';
				const paneW = this.composite ? Math.min(PREVIEW_W, viewW) : 0;
				const rightLimit = RAIL_W + viewW - paneW;
				const onionX = Math.max(RAIL_W, rightLimit - onionText.length);
				this.drawClipped(
					buf,
					onionText,
					onionX,
					0,
					RAIL_W,
					rightLimit,
					this.onion ? C.hot : C.dim,
					C.chromeBg,
				);
				onionToggle = { x0: onionX, x1: onionX + onionText.length - 1, y: 0 };
			}
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

		const onion = viewState.frame === this.state.frame;

		const filmNames = showTabs
			? animationFrames(this.state, this.state.animation)
			: [];
		const names = filmNames.length > 1 ? filmNames : [this.state.frame];
		const activeIdx = Math.max(0, names.indexOf(this.state.frame));
		const stride = pxW * z + FILMSTRIP_GAP;
		const boxes = names.map((name, i) => {
			const x0 = origin.x + (i - activeIdx) * stride;
			return { name, i, x0, x1: x0 + pxW * z };
		});

		const lastBox = boxes[boxes.length - 1];
		const tileY0 = origin.y;
		const tileY1 = origin.y + pxH * z;
		const PLUS_W = 3;
		const tileX0 = lastBox.x1 + FILMSTRIP_GAP;
		const plusVisible =
			showTabs && tileX0 < RAIL_W + viewW && tileX0 + PLUS_W > RAIL_W;
		const plusTile = plusVisible
			? { x0: tileX0, x1: tileX0 + PLUS_W - 1, y0: tileY0, y1: tileY1 }
			: null;
		this.geom.focus = {
			tabs,
			origin,
			top,
			pxH,
			frames: boxes.map((b) => ({ name: b.name, x0: b.x0, x1: b.x1 })),
			plusTile,
			onionToggle,
		};

		const stateFor = new Map<string, SpriteEditorState>();
		for (const b of boxes)
			stateFor.set(
				b.name,
				b.name === this.state.frame
					? viewState
					: { ...this.state, frame: b.name },
			);

		for (let sy = top; sy < viewH; sy++) {
			for (let sx = RAIL_W; sx < RAIL_W + viewW; sx++) {
				const py = this.cam.y + Math.floor((sy - origin.y) / z);
				const box = boxes.find((b) => sx >= b.x0 && sx < b.x1);
				let color = C.bg;
				if (box && py >= 0 && py < pxH) {
					const px = this.cam.x + Math.floor((sx - box.x0) / z);
					if (px >= 0 && px < pxW) {
						const active = box.i === activeIdx;
						const st = stateFor.get(box.name) ?? viewState;
						color = this.pixelRGBA(st, px, py, sx + sy, C, active && onion);
						if (!active) color = this.dimRGBA(color, C);
					}
				}
				buf.setCell(sx, sy, ' ', C.dim, color);
			}
		}

		if (plusTile) {
			const midY = Math.floor((plusTile.y0 + plusTile.y1 - 1) / 2);
			this.drawClipped(
				buf,
				'[+]',
				plusTile.x0,
				midY,
				RAIL_W,
				RAIL_W + viewW,
				C.hot,
				C.bg,
			);
		}

		for (const m of this.displayMarkers()) {
			const sx = origin.x + (m.x * 2 - this.cam.x) * z;
			const sy = origin.y + (m.y * 2 - this.cam.y) * z;
			if (sx < RAIL_W || sx >= RAIL_W + viewW || sy < top || sy >= viewH)
				continue;
			this.geom.anchorCells.push({
				x: sx,
				y: sy,
				name: m.name,
				overridden: m.overridden,
			});
			buf.setCell(
				sx,
				sy,
				ANCHOR_MARKER,
				m.overridden ? C.overrideFg : C.anchorFg,

				this.pixelRGBA(viewState, m.x * 2, m.y * 2, sx + sy, C, onion),
			);
		}

		const mapFocus = (px: number, py: number) => ({
			x: origin.x + (px - this.cam.x) * z,
			y: origin.y + (py - this.cam.y) * z,
		});
		const focusClip = { x0: RAIL_W, x1: RAIL_W + viewW, y0: top, y1: viewH };
		this.drawShapePreview(buf, mapFocus, focusClip, C);

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

		const layout = solveDegradation({
			termW: W,
			termH: H,
			zoom: this.zoom,
			maxFrameCellW: this.maxFrameCellW(),
			frameCount: allFrames(this.state.doc).length,
			inkCount: this.entries().length + 1,
			variantRowCount: variantRowCountOf(
				variantOptions(docDynamicUsage(this.state.doc), this.variant),
			),
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

		const displayFrame = this.displayFrame;
		const viewState =
			displayFrame === this.state.frame
				? this.floatState()
				: { ...this.state, frame: displayFrame };

		const canvasW = Math.max(1, W - RAIL_W);
		const viewW = canvasW;
		this.geom.viewH = viewH;
		this.geom.viewW = viewW;

		this.renderRail(buf, viewH, C);

		this.buildOnionLayers(C);

		const effectiveView =
			this.forceFocus && this.view === 'strips' ? 'focus' : this.view;
		this.geom.anchorCells = [];
		if (this.playMode !== 'none') {
			this.renderFocus(buf, viewW, viewH, viewState, false, C);
		} else if (effectiveView === 'focus') {
			this.renderFocus(buf, viewW, viewH, viewState, true, C);
		} else {
			this.renderStrips(buf, viewW, viewH, C);
		}

		this.geom.preview = null;
		if (this.composite) {
			this.renderPreviewPane(buf, W, viewH, displayFrame, C);
		}

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
			anchorScope: anchorScopeFor(this.state),
		});

		const transient =
			this.playMode !== 'none'
				? this.playMode === 'walk'
					? `▶ walk preview (${displayFrame})`
					: `▶ playing ${this.state.animation} (${displayFrame})`
				: this.awaitingStamp
					? 'stamp: press a character (Esc cancels)'
					: this.saved && this.saveDiags
						? saveDiagSummary(
								this.saveDiags.map((d) => ({
									severity: d.severity,
									message: d.message,
								})),
							)
						: (this.focusHint ?? requiredHintLine(this.state.doc, this.role));
		const feedback = transient || this.state.feedback;
		const status = composeStatusLine(statusLeft, feedback, W);
		const statusRow = H - CHROME_H;
		buf.fillRect(0, statusRow, W, 1, C.chromeBg);
		buf.drawText(status, 0, statusRow, C.text, C.chromeBg);
		const hotNote =
			this.playMode !== 'none' || this.awaitingStamp || this.focusHint;
		if (feedback && status.endsWith(feedback)) {
			const rx = status.length - feedback.length;
			buf.drawText(
				feedback,
				rx,
				statusRow,
				hotNote ? C.hot : C.feedback,
				C.chromeBg,
			);
		} else if (transient) {
			const text = transient.slice(0, W);
			buf.drawText(
				text,
				Math.max(0, W - text.length),
				statusRow,
				hotNote ? C.hot : C.feedback,
				C.chromeBg,
			);
		}

		this.renderHelp(buf, W, H, C);
		this.renderColorPicker(buf, W, H, C);
		this.renderAnimationMenu(buf, W, H, C);
		this.renderAnchorMenu(buf, W, H, C);
		this.renderCanvasModal(buf, W, H, C);
	}

	private renderPreviewPane(
		buf: OptimizedBuffer,
		W: number,
		viewH: number,
		frameName: string,
		C: Palette,
	): void {
		const paneW = Math.min(PREVIEW_W, W - RAIL_W);
		const paneH = Math.min(PREVIEW_H, viewH);

		if (paneW < 10 || paneH < 5) return;
		const x0 = W - paneW;
		const y0 = 0;
		const x1 = x0 + paneW - 1;
		const y1 = y0 + paneH - 1;

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

		const ix = x0 + 1;
		const iy = y0 + 1;
		const iw = paneW - 2;
		const ih = paneH - 2;

		const previews = this.dynamicPreviews();
		const style = styleWithLocalColors(
			styleWithLocalColors(this.sceneStyle, this.state.doc.colors),
			{ p: previews.p, a: previews.a },
		);

		const previewDoc = floatDisplayDoc(this.state);
		const surface = renderComposite(
			previewDoc,
			this.role,
			style,
			{
				facing: this.previewFacing,
				stance: frameName,
				elapsedS: 0,
				hue: this.variant.p,
			},
			{ width: iw, height: ih },
		);
		if (surface)
			encodeSurface(surface, (x, y, ch, fg, bg) =>
				buf.setCell(ix + x, iy + y, ch, fg, bg),
			);
		else buf.drawText('keep drawing…'.slice(0, iw), ix, iy, C.dim, C.bg);

		const flipText = `flip ${this.previewFacing === 1 ? '→' : '←'}`;
		const animPlaying = this.playMode === 'animation';
		const playText = animPlaying ? '■ stop' : '▶ play';
		const flipX = x0 + 2;
		buf.drawText(flipText, flipX, y1, C.text, C.boxBg);
		const playX = flipX + flipText.length + 2;
		buf.drawText(playText, playX, y1, animPlaying ? C.hot : C.text, C.boxBg);

		this.geom.preview = {
			x0,
			y0,
			w: paneW,
			h: paneH,
			flip: { x0: flipX, x1: flipX + flipText.length - 1, y: y1 },
			play: { x0: playX, x1: playX + playText.length - 1, y: y1 },
		};
	}

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

	private renderHelp(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		C: Palette,
	): void {
		if (!this.helpOpen) return;
		this.drawModal(buf, W, H, helpOverlayRows(H - 2), C);
	}

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

	private drawModal(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		rows: string[],
		C: Palette,
	): { ox: number; oy: number; w: number; h: number } {
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
		return { ox, oy, w: boxW, h: boxH };
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
			rows.push('Enter switch · c new · d del');
			rows.push('p play · w walk · f fps · ←/→ frame · </> reorder · Esc');
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
		this.geom.anchorMenuBox = null;
		if (!menu) return;
		const rows: string[] = [];
		if (menu.input) {
			rows.push('New anchor name');
			rows.push(`▸ ${menu.input.buffer || '_'}`);
			if (menu.error) rows.push(`⚠ ${menu.error}`);
			rows.push('Enter confirm · Esc back');
			this.drawModal(buf, W, H, rows, C);
			return;
		}

		rows.push('Pick anchor (click · Enter)');
		for (let i = 0; i < menu.names.length; i++) {
			const name = menu.names[i];
			rows.push(`${i === menu.index ? '▸' : ' '} ${name}`);
		}
		const newSel = menu.index >= menu.names.length ? '▸' : ' ';
		rows.push(`${newSel} + new anchor`);
		rows.push('click place next · Esc close');

		const boxW = Math.min(W, Math.max(20, ...rows.map((r) => r.length + 2)));
		for (let i = 0; i < menu.names.length; i++) {
			if (menu.required.includes(menu.names[i])) continue;
			rows[i + 1] = `${rows[i + 1].padEnd(boxW - 2)}✕`;
		}
		this.geom.anchorMenuBox = this.drawModal(buf, W, H, rows, C);
	}

	private renderCanvasModal(
		buf: OptimizedBuffer,
		W: number,
		H: number,
		C: Palette,
	): void {
		this.geom.canvasModal = null;
		const m = this.canvasModal;
		if (!m) return;

		const CW = 1;
		const CH = 1;
		const { w, h } = canvasTarget(m);
		const title = `canvas ${m.w0}×${m.h0} → ${w}×${h}`;
		const hint = 'drag edges/corners · arrows nudge · enter apply · esc';
		const boxW = Math.min(
			W - 2,
			Math.max(title.length + 4, hint.length + 4, 60),
		);
		const boxH = Math.min(H - 2, 20);
		const ox = Math.max(0, Math.floor((W - boxW) / 2));
		const oy = Math.max(0, Math.floor((H - boxH) / 2));
		buf.fillRect(ox, oy, boxW, boxH, C.boxBg);
		buf.drawText(title.slice(0, boxW - 2), ox + 2, oy, C.text, C.boxBg);
		buf.drawText(
			hint.slice(0, boxW - 2),
			ox + 2,
			oy + boxH - 1,
			C.dim,
			C.boxBg,
		);

		const inX0 = ox + 2;
		const inY0 = oy + 2;
		const inX1 = ox + boxW - 2;
		const inY1 = oy + boxH - 2;

		const ox0 = inX0 + Math.max(0, Math.floor((inX1 - inX0 - m.w0 * CW) / 2));
		const oy0 = inY0 + Math.max(0, Math.floor((inY1 - inY0 - m.h0 * CH) / 2));
		const inBox = (sx: number, sy: number) =>
			sx >= inX0 && sx < inX1 && sy >= inY0 && sy < inY1;

		const previews = this.dynamicPreviews();
		const style = styleWithLocalColors(
			styleWithLocalColors(this.sceneStyle, this.state.doc.colors),
			{ p: previews.p, a: previews.a },
		);
		const labels = frameLocations(this.state.doc).map((f) => f.label);
		const plains = labels.map((label) =>
			renderPlainFrame(this.state.doc, label, style),
		);
		const defaultPlain = plains[0] ?? null;

		const warns: { sx: number; sy: number }[] = [];
		const inkedAny = (cx: number, cy: number): boolean =>
			plains.some((p) => p?.at(cx, cy) != null);

		const xL = -m.left;
		const xR = m.w0 + m.right;
		const yT = -m.top;
		const yB = m.h0 + m.bottom;
		const cx0 = Math.min(0, xL);
		const cx1 = Math.max(m.w0, xR);
		const cy0 = Math.min(0, yT);
		const cy1 = Math.max(m.h0, yB);
		for (let cy = cy0; cy < cy1; cy++) {
			for (let cx = cx0; cx < cx1; cx++) {
				const sx = ox0 + cx * CW;
				const sy = oy0 + cy * CH;
				if (!inBox(sx, sy)) continue;
				const insideBounds = cx >= xL && cx < xR && cy >= yT && cy < yB;
				const bgLayer = insideBounds
					? (cx + cy) % 2 === 0
						? C.grid
						: C.bg
					: C.boxBg;

				if (isClipped(m, cx, cy) && inkedAny(cx, cy)) {
					buf.setCell(sx, sy, ' ', C.dim, C.feedback);
					warns.push({ sx, sy });
					continue;
				}
				const d = defaultPlain?.at(cx, cy) ?? null;
				if (d) {
					const fg = RGBA.fromInts(d.fg[0], d.fg[1], d.fg[2], d.fg[3]);
					const bg = d.bg
						? RGBA.fromInts(d.bg[0], d.bg[1], d.bg[2], d.bg[3])
						: bgLayer;
					buf.setCell(sx, sy, d.ch, fg, bg);
					continue;
				}

				buf.setCell(sx, sy, ' ', C.dim, bgLayer);
			}
		}

		const leftX = ox0 + xL * CW - 1;
		const rightX = ox0 + xR * CW;
		const topY = oy0 + yT * CH - 1;
		const bottomY = oy0 + yB * CH;
		const edge = (sx: number, sy: number, ch: string) => {
			if (
				sx >= ox + 1 &&
				sx < ox + boxW - 1 &&
				sy >= oy + 1 &&
				sy < oy + boxH - 1
			)
				buf.setCell(sx, sy, ch, C.hot, C.boxBg);
		};
		for (let sy = topY; sy <= bottomY; sy++) {
			edge(leftX, sy, '│');
			edge(rightX, sy, '│');
		}
		for (let sx = leftX; sx <= rightX; sx++) {
			edge(sx, topY, '─');
			edge(sx, bottomY, '─');
		}
		edge(leftX, topY, '┌');
		edge(rightX, topY, '┐');
		edge(leftX, bottomY, '└');
		edge(rightX, bottomY, '┘');

		for (const { sx, sy } of warns)
			if (inBox(sx, sy)) buf.setCell(sx, sy, ' ', C.dim, C.feedback);

		this.geom.canvasModal = {
			ox0,
			oy0,
			cw: CW,
			ch: CH,
			leftX,
			rightX,
			topY,
			bottomY,
			box: { ox, oy, w: boxW, h: boxH },
		};
	}
}

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

		initialFeedback = `creating new sprite ${dirForRole(role)}/${target.id}`;
	}

	const { createCliRenderer } = await import('@opentui/core');
	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: RENDERER_CLEAR_COLOR,
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

	renderer.setFrameCallback(async (dt: number) => editor.tick(dt));
	renderer.start();
}
