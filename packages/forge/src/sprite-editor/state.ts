import type { RGBAQuad } from '@mmo/core/entities';
import {
	findFrame,
	frameLabelAt,
	frameLocations,
	glyphFromQuadrants,
	mapDocFrames,
	parseSpriteFile,
	quadrantsFromGlyph,
	SENTINEL,
	type SpriteAnimationDoc,
	type SpriteDiagnostic,
	type SpriteDoc,
	type SpriteFrameDoc,
	serializeSpriteFile,
} from '@mmo/render';
import {
	canRedo,
	canUndo,
	type History,
	initHistory,
	record,
	redo,
	undo,
} from '../history';
import { applyCanvasModal, type CanvasModal } from './canvasModal';
import { normalizeDoc, trimDoc } from './resize';

export type SpriteTool =
	| 'paint'
	| 'erase'
	| 'fill'
	| 'stamp'
	| 'anchor'
	| 'line'
	| 'rect'
	| 'ellipse'
	| 'select'
	| 'move'
	| 'paste';

export const SHAPE_TOOLS = ['line', 'rect', 'ellipse'] as const;
export type ShapeTool = (typeof SHAPE_TOOLS)[number];

export type AnchorTool = ShapeTool | 'select';

export function isShapeTool(tool: SpriteTool): tool is ShapeTool {
	return (SHAPE_TOOLS as readonly string[]).includes(tool);
}

export type ShapeMode = 'outline' | 'filled';

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface PendingShape {
	readonly tool: AnchorTool;
	readonly anchor: Point;
	readonly to: Point;
	readonly constrain: boolean;
	readonly ink: Ink;
}

export interface Selection {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

export interface FloatPixel {
	readonly x: number;
	readonly y: number;
	readonly key: string;
}

export interface FloatStamp {
	readonly cellX: number;
	readonly cellY: number;
	readonly glyph: string;
	readonly fg: string;
}

export interface Float {
	readonly pixels: readonly FloatPixel[];
	readonly stamps: readonly FloatStamp[];
	readonly source: Selection;
	readonly grab: Point;
	readonly dx: number;
	readonly dy: number;

	readonly lifted?: boolean;
}

export interface Clipboard {
	readonly pixels: readonly FloatPixel[];
	readonly stamps: readonly FloatStamp[];
	readonly source: Selection;
}

export type AnchorScope = 'doc' | 'frame';

const NAME_RE = /^[A-Za-z0-9:_-]+$/;

export type Ink =
	| { readonly kind: 'color'; readonly key: string }
	| { readonly kind: 'transparent' };

export const TRANSPARENT_INK: Ink = { kind: 'transparent' };

export function colorInk(key: string): Ink {
	return { kind: 'color', key };
}

export function inkColorKey(ink: Ink): string | null {
	return ink.kind === 'color' ? ink.key : null;
}

export function inkLabel(ink: Ink): string {
	return ink.kind === 'color' ? ink.key : 'transparent';
}

export function inkEquals(a: Ink, b: Ink): boolean {
	if (a.kind === 'transparent') return b.kind === 'transparent';
	return b.kind === 'color' && a.key === b.key;
}

export interface SpriteEditorState {
	doc: SpriteDoc;

	frame: string;

	animation: string;

	cursor: { x: number; y: number };
	tool: SpriteTool;

	ink: Ink;

	anchorName: string;

	feedback: string;
	history: History<SpriteDoc>;

	stroke: string | null;
	strokeSeq: number;

	shape: PendingShape | null;

	rectMode: ShapeMode;
	ellipseMode: ShapeMode;

	lastPaint: Point | null;

	selection: Selection | null;

	float: Float | null;

	clipboard: Clipboard | null;
}

export interface CellView {
	glyph: string;
	fg: string;
	bg: string;
	mask: number | undefined;
}

export interface PaletteEntry {
	key: string;
	rgba: RGBAQuad;
	label: string;
	kind: 'local' | 'palette' | 'dynamic';
}

export interface DynamicPreviews {
	p: RGBAQuad;
	a: RGBAQuad;
}

const RESERVED_KEYS = new Set(['p', 'a']);
const DEFAULT_KEY = 'p';

export function initSpriteEditor(
	doc: SpriteDoc,
	frame?: string,
): SpriteEditorState {
	const normalized = normalizeDoc(doc);
	const locations = frameLocations(normalized);
	const first = locations[0];
	const label =
		frame !== undefined && locations.some((l) => l.label === frame)
			? frame
			: (first?.label ?? '');
	return {
		doc: normalized,
		frame: label,
		animation:
			animationContaining(normalized, label) ?? first?.animation.name ?? '',
		cursor: { x: 0, y: 0 },

		tool: 'select',
		ink: colorInk(normalized.key),
		anchorName: firstAnchorName(normalized),
		feedback: '',
		history: initHistory(normalized),
		stroke: null,
		strokeSeq: 0,
		shape: null,
		rectMode: 'outline',
		ellipseMode: 'outline',
		lastPaint: null,
		selection: null,
		float: null,
		clipboard: null,
	};
}

function animationContaining(
	doc: SpriteDoc,
	frame: string,
): string | undefined {
	return findFrame(doc, frame)?.animation.name;
}

function firstAnchorName(doc: SpriteDoc): string {
	return Object.keys(doc.anchors)[0] ?? '';
}

export function currentFrame(state: SpriteEditorState): SpriteFrameDoc {
	const f = findFrame(state.doc, state.frame)?.frame;
	if (!f) throw new Error(`no such frame '${state.frame}'`);
	return f;
}

export function frameNames(state: SpriteEditorState): string[] {
	return frameLocations(state.doc).map((l) => l.label);
}

export function frameExtent(frame: SpriteFrameDoc): { w: number; h: number } {
	return { w: frame.rows[0]?.length ?? 0, h: frame.rows.length };
}

export function pixelToCell(
	px: number,
	py: number,
): { cellX: number; cellY: number; bit: number } {
	const cellX = Math.floor(px / 2);
	const cellY = Math.floor(py / 2);
	const sx = px - cellX * 2;
	const sy = py - cellY * 2;

	return { cellX, cellY, bit: sx + sy * 2 };
}

export function cellAt(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
): CellView {
	const frame = currentFrame(state);
	const { w, h } = frameExtent(frame);
	if (cellX < 0 || cellY < 0 || cellX >= w || cellY >= h)
		return { glyph: ' ', fg: '', bg: '', mask: 0 };
	const glyph = frame.rows[cellY][cellX];
	const fgRaw = frame.colors[cellY][cellX];
	const bgRaw = frame.bg[cellY][cellX];
	return {
		glyph,
		fg: fgRaw === ' ' ? '' : fgRaw,
		bg: bgRaw === ' ' ? '' : bgRaw,
		mask: quadrantsFromGlyph(glyph),
	};
}

export function readPixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): boolean {
	if (px < 0 || py < 0) return false;
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	if (cell.mask === undefined) return false;
	return (cell.mask & (1 << bit)) !== 0;
}

function grownFrame(
	frame: SpriteFrameDoc,
	cellX: number,
	cellY: number,
): SpriteFrameDoc {
	const { w, h } = frameExtent(frame);
	const newW = Math.max(w, cellX + 1);
	const newH = Math.max(h, cellY + 1);
	if (newW === w && newH === h) return frame;
	const grow = (grid: readonly string[]): string[] => {
		const out = grid.map((row) => row.padEnd(newW, ' '));
		while (out.length < newH) out.push(' '.repeat(newW));
		return out;
	};
	return {
		...frame,
		rows: grow(frame.rows),
		colors: grow(frame.colors),
		bg: grow(frame.bg),
	};
}

function setChar(row: string, x: number, ch: string): string {
	return row.slice(0, x) + ch + row.slice(x + 1);
}

function writeCell(
	frame: SpriteFrameDoc,
	cellX: number,
	cellY: number,
	glyph: string,
	fgChar: string,
	bgChar: string,
): SpriteFrameDoc {
	const grown = grownFrame(frame, cellX, cellY);
	return {
		...grown,
		rows: grown.rows.map((r, y) =>
			y === cellY ? setChar(r, cellX, glyph) : r,
		),
		colors: grown.colors.map((r, y) =>
			y === cellY ? setChar(r, cellX, fgChar) : r,
		),
		bg: grown.bg.map((r, y) => (y === cellY ? setChar(r, cellX, bgChar) : r)),
	};
}

function replaceFrame(
	doc: SpriteDoc,
	label: string,
	frame: SpriteFrameDoc,
): SpriteDoc {
	const loc = findFrame(doc, label);
	if (loc === undefined) return doc;
	const animationName = loc.animation.name;
	const index = loc.index;
	return {
		...doc,
		animations: doc.animations.map((a) =>
			a.name === animationName
				? { ...a, frames: a.frames.map((f, i) => (i === index ? frame : f)) }
				: a,
		),
	};
}

function refuse(state: SpriteEditorState, message: string): SpriteEditorState {
	return { ...state, feedback: message };
}

function commitDoc(
	state: SpriteEditorState,
	nextDoc: SpriteDoc,
	tag?: string,
): SpriteEditorState {
	return {
		...state,
		doc: nextDoc,
		history: record(state.history, nextDoc, tag),
		feedback: '',
	};
}

function commitFrame(
	state: SpriteEditorState,
	frame: SpriteFrameDoc,
	tag?: string,
): SpriteEditorState {
	return commitDoc(state, replaceFrame(state.doc, state.frame, frame), tag);
}

export function beginStroke(state: SpriteEditorState): SpriteEditorState {
	const seq = state.strokeSeq + 1;
	return { ...state, stroke: `stroke${seq}`, strokeSeq: seq };
}

export function endStroke(state: SpriteEditorState): SpriteEditorState {
	return { ...state, stroke: null };
}

export function setTool(
	state: SpriteEditorState,
	tool: SpriteTool,
): SpriteEditorState {
	return { ...state, tool, feedback: '' };
}

export function moveCursor(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	return { ...state, cursor: { x: Math.max(0, px), y: Math.max(0, py) } };
}

function validKey(key: string): boolean {
	return key.length === 1 && key !== SENTINEL && key !== ' ';
}

export function setInk(state: SpriteEditorState, ink: Ink): SpriteEditorState {
	if (ink.kind === 'color' && !validKey(ink.key))
		return refuse(state, `'${ink.key}' is not a usable color key`);
	return { ...state, ink, feedback: '' };
}

export function selectFrame(
	state: SpriteEditorState,
	label: string,
): SpriteEditorState {
	const loc = findFrame(state.doc, label);
	if (loc === undefined) return refuse(state, `no such frame '${label}'`);
	return {
		...state,
		frame: label,
		animation: loc.animation.name,
		stroke: null,
		feedback: '',
	};
}

function animationByName(
	doc: SpriteDoc,
	name: string,
): SpriteAnimationDoc | undefined {
	return doc.animations.find((a) => a.name === name);
}

export function animationNames(state: SpriteEditorState): string[] {
	return state.doc.animations.map((a) => a.name);
}

export function animationFrames(
	state: SpriteEditorState,
	animation: string,
): string[] {
	const a = animationByName(state.doc, animation);
	if (a === undefined) return [];
	return a.frames.map((_, i) => frameLabelAt(a, i));
}

function newBlankFrame(state: SpriteEditorState): SpriteFrameDoc {
	const cur = findFrame(state.doc, state.frame)?.frame;
	const { w, h } = cur ? frameExtent(cur) : { w: 6, h: 4 };
	const rows = Array.from({ length: Math.max(1, h) }, () =>
		' '.repeat(Math.max(1, w)),
	);
	return { rows, colors: rows.slice(), bg: rows.slice(), anchors: {} };
}

export function createAnimation(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	if (!NAME_RE.test(name))
		return refuse(
			state,
			`'${name}' is not a legal animation name (${NAME_RE.source})`,
		);
	if (animationByName(state.doc, name) !== undefined)
		return refuse(state, `animation '${name}' already exists`);
	const frame = newBlankFrame(state);
	const animation: SpriteAnimationDoc = { name, frames: [frame] };
	const nextDoc: SpriteDoc = {
		...state.doc,
		animations: [...state.doc.animations, animation],
	};
	const committed = commitDoc(state, nextDoc);

	return { ...committed, animation: name, frame: name };
}

export function addFrameToAnimation(
	state: SpriteEditorState,
	animation: string,
): SpriteEditorState {
	const target = animationByName(state.doc, animation);
	if (target === undefined)
		return refuse(state, `no such animation '${animation}'`);
	const frame = newBlankFrame(state);
	const nextFrames = [...target.frames, frame];
	const nextDoc: SpriteDoc = {
		...state.doc,
		animations: state.doc.animations.map((a) =>
			a.name === animation ? { ...a, frames: nextFrames } : a,
		),
	};
	const committed = commitDoc(state, nextDoc);
	const newIndex = nextFrames.length - 1;
	return {
		...committed,
		animation,
		frame: `${animation} ${newIndex}`,
	};
}

export function cloneFrameToAnimation(
	state: SpriteEditorState,
	animation: string,
): SpriteEditorState {
	const target = animationByName(state.doc, animation);
	if (target === undefined)
		return refuse(state, `no such animation '${animation}'`);
	const last = target.frames[target.frames.length - 1];
	const clone: SpriteFrameDoc = last
		? {
				rows: [...last.rows],
				colors: [...last.colors],
				bg: [...last.bg],
				anchors: { ...last.anchors },
			}
		: newBlankFrame(state);
	const nextFrames = [...target.frames, clone];
	const nextDoc: SpriteDoc = {
		...state.doc,
		animations: state.doc.animations.map((a) =>
			a.name === animation ? { ...a, frames: nextFrames } : a,
		),
	};
	const committed = commitDoc(state, nextDoc);
	const newIndex = nextFrames.length - 1;
	return { ...committed, animation, frame: `${animation} ${newIndex}` };
}

export function deleteAnimation(
	state: SpriteEditorState,
	animation: string,
): SpriteEditorState {
	if (animationByName(state.doc, animation) === undefined)
		return refuse(state, `no such animation '${animation}'`);
	if (state.doc.animations.length <= 1)
		return refuse(state, 'cannot delete the last animation');
	const nextAnimations = state.doc.animations.filter(
		(a) => a.name !== animation,
	);
	const nextDoc: SpriteDoc = { ...state.doc, animations: nextAnimations };
	const committed = commitDoc(state, nextDoc);

	if (state.animation !== animation) return committed;
	const first = nextAnimations[0];
	return {
		...committed,
		animation: first.name,
		frame: frameLabelAt(first, 0),
	};
}

export function selectAnimation(
	state: SpriteEditorState,
	animation: string,
): SpriteEditorState {
	const target = animationByName(state.doc, animation);
	if (target === undefined)
		return refuse(state, `no such animation '${animation}'`);
	return {
		...state,
		animation,
		frame: frameLabelAt(target, 0),
		stroke: null,
		feedback: '',
	};
}

export function reorderFrame(
	state: SpriteEditorState,
	animation: string,
	index: number,
	delta: number,
): SpriteEditorState {
	const target = animationByName(state.doc, animation);
	if (target === undefined)
		return refuse(state, `no such animation '${animation}'`);
	const list = target.frames;
	const to = index + delta;
	if (index < 0 || index >= list.length || to < 0 || to >= list.length)
		return refuse(state, 'cannot move that frame — out of range');
	const next = [...list];
	[next[index], next[to]] = [next[to], next[index]];
	const nextDoc: SpriteDoc = {
		...state.doc,
		animations: state.doc.animations.map((a) =>
			a.name === animation ? { ...a, frames: next } : a,
		),
	};
	return commitDoc(state, nextDoc);
}

export function setAnimationFps(
	state: SpriteEditorState,
	animation: string,
	fps: number | null,
): SpriteEditorState {
	if (animationByName(state.doc, animation) === undefined)
		return refuse(state, `no such animation '${animation}'`);
	if (fps !== null && (!Number.isFinite(fps) || fps <= 0))
		return refuse(state, 'fps must be a positive number');
	const nextDoc: SpriteDoc = {
		...state.doc,
		animations: state.doc.animations.map((a) => {
			if (a.name !== animation) return a;
			if (fps === null) {
				const { fps: _drop, ...rest } = a;
				return rest;
			}
			return { ...a, fps };
		}),
	};
	return commitDoc(state, nextDoc);
}

export interface AnchorMarker {
	name: string;
	x: number;
	y: number;

	overridden: boolean;
}

export function anchorMarkers(state: SpriteEditorState): AnchorMarker[] {
	const frame = currentFrame(state);
	const out = new Map<string, AnchorMarker>();
	for (const [name, a] of Object.entries(state.doc.anchors))
		out.set(name, { name, x: a.x, y: a.y, overridden: false });
	for (const [name, a] of Object.entries(frame.anchors))
		out.set(name, { name, x: a.x, y: a.y, overridden: true });
	return [...out.values()];
}

export function setAnchorName(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	if (!NAME_RE.test(name))
		return refuse(state, `'${name}' is not a legal anchor name`);
	return { ...state, anchorName: name, feedback: '' };
}

export function anchorScopeFor(state: SpriteEditorState): AnchorScope {
	return state.frame === frameLocations(state.doc)[0]?.label ? 'doc' : 'frame';
}

export function placeAnchor(
	state: SpriteEditorState,
	name: string,
	cellX: number,
	cellY: number,
): SpriteEditorState {
	const scope = anchorScopeFor(state);
	if (!NAME_RE.test(name))
		return refuse(state, `'${name}' is not a legal anchor name`);
	if (cellX < 0 || cellY < 0)
		return refuse(state, 'an anchor cannot sit at a negative cell');

	const { w, h } = frameExtent(currentFrame(state));
	const oob = cellX >= w || cellY >= h;
	const note = oob ? `anchor '${name}' is outside the art bounds` : '';
	if (scope === 'doc') {
		const nextDoc: SpriteDoc = {
			...state.doc,
			anchors: { ...state.doc.anchors, [name]: { x: cellX, y: cellY } },
		};
		return { ...commitDoc(state, nextDoc), feedback: note };
	}
	const frame = currentFrame(state);
	const nextFrame: SpriteFrameDoc = {
		...frame,
		anchors: { ...frame.anchors, [name]: { x: cellX, y: cellY } },
	};
	return { ...commitFrame(state, nextFrame), feedback: note };
}

export function deleteAnchor(
	state: SpriteEditorState,
	name: string,
	required: readonly string[],
): SpriteEditorState {
	if (required.includes(name))
		return refuse(
			state,
			`'${name}' is required for this role — move it instead`,
		);
	if (!(name in state.doc.anchors))
		return refuse(state, `no such anchor '${name}'`);
	const anchors = { ...state.doc.anchors };
	delete anchors[name];
	const nextDoc: SpriteDoc = {
		...mapDocFrames(state.doc, (f) => {
			if (!(name in f.anchors)) return f;
			const fa = { ...f.anchors };
			delete fa[name];
			return { ...f, anchors: fa };
		}),
		anchors,
	};
	const committed = commitDoc(state, nextDoc);

	if (committed.anchorName !== name) return committed;
	return { ...committed, anchorName: firstAnchorName(nextDoc) };
}

export function removeAnchorOverride(
	state: SpriteEditorState,
	name: string,
): SpriteEditorState {
	const frame = currentFrame(state);
	if (!(name in frame.anchors))
		return refuse(
			state,
			`frame '${state.frame}' has no override for '${name}'`,
		);
	const anchors = { ...frame.anchors };
	delete anchors[name];
	return commitFrame(state, { ...frame, anchors });
}

function commitPaint(
	state: SpriteEditorState,
	frame: SpriteFrameDoc,
	note: string,
): SpriteEditorState {
	const committed = commitFrame(state, frame, state.stroke ?? undefined);
	return note ? { ...committed, feedback: note } : committed;
}

function commitQuadrant(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
	mask: number,
	fgKey: string,
	bgKey: string,
	note: string,
): SpriteEditorState {
	const frame = writeCell(
		currentFrame(state),
		cellX,
		cellY,
		glyphFromQuadrants(mask),
		mask === 0 ? ' ' : fgKey,
		bgKey === '' ? ' ' : bgKey,
	);
	return commitPaint(state, frame, note);
}

export function paintWithInk(
	state: SpriteEditorState,
	px: number,
	py: number,
	ink: Ink,
): SpriteEditorState {
	const { w, h } = frameExtent(currentFrame(state));
	if (px < 0 || py < 0 || px >= w * 2 || py >= h * 2)
		return refuse(state, 'clipped — nothing painted past the canvas edge');
	return ink.kind === 'transparent'
		? punchTransparent(state, px, py)
		: paintColor(state, px, py, ink.key);
}

export function paintPixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	return paintWithInk(state, px, py, state.ink);
}

export function erasePixel(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	return paintWithInk(state, px, py, TRANSPARENT_INK);
}

function paintColor(
	state: SpriteEditorState,
	px: number,
	py: number,
	key: string,
): SpriteEditorState {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	const t = 1 << bit;

	if (cell.mask === undefined)
		return commitQuadrant(
			state,
			cellX,
			cellY,
			t,
			key,
			'',
			`replaced stamp '${cell.glyph}'`,
		);

	const opaque = cell.bg !== '';
	const hasFg = cell.mask > 0;

	if (!hasFg || cell.fg === key) {
		const newMask = cell.mask | t;

		const dropBg = newMask === 15 && cell.bg !== '';
		const bg = dropBg ? '' : cell.bg;
		const note = dropBg ? `filled — background '${cell.bg}' dropped` : '';

		if (
			glyphFromQuadrants(newMask) === cell.glyph &&
			key === cell.fg &&
			bg === cell.bg
		)
			return { ...state, feedback: '' };
		return commitQuadrant(state, cellX, cellY, newMask, key, bg, note);
	}

	if (opaque) {
		const newMask = cell.mask | t;
		const bg = newMask === 15 ? '' : cell.bg;
		const note =
			newMask === 15
				? `recoloured foreground → '${key}', background '${cell.bg}' dropped`
				: `recoloured foreground '${cell.fg}' → '${key}'`;
		return commitQuadrant(state, cellX, cellY, newMask, key, bg, note);
	}

	if ((cell.mask & ~t) === 0)
		return commitQuadrant(
			state,
			cellX,
			cellY,
			t,
			key,
			'',
			`recoloured '${cell.fg}' → '${key}'`,
		);

	return commitQuadrant(
		state,
		cellX,
		cellY,
		t,
		key,
		cell.fg,
		`overpainted '${cell.fg}' → background`,
	);
}

function punchTransparent(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);

	if (cell.mask === undefined)
		return commitQuadrant(
			state,
			cellX,
			cellY,
			0,
			'',
			'',
			`cleared stamp '${cell.glyph}'`,
		);

	const t = 1 << bit;
	const pixelAlreadyClear = (cell.mask & t) === 0;

	if (pixelAlreadyClear && cell.bg === '') return { ...state, feedback: '' };

	const newMask = cell.mask & ~t;
	const note = cell.bg !== '' ? `punched background '${cell.bg}'` : '';
	return commitQuadrant(state, cellX, cellY, newMask, cell.fg, '', note);
}

type PixelClass =
	| { readonly wall: true }
	| { readonly wall: false; readonly key: string };

function pixelClass(
	state: SpriteEditorState,
	px: number,
	py: number,
): PixelClass {
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);
	if (cell.mask === undefined) return { wall: true };
	const lit = (cell.mask & (1 << bit)) !== 0;
	return { wall: false, key: lit ? cell.fg : cell.bg };
}

function applyFill(
	state: SpriteEditorState,
	region: readonly { x: number; y: number }[],
	stampCells: ReadonlySet<string>,
	ink: Ink,
): SpriteEditorState {
	const pixels = [...region].sort((a, b) => a.y - b.y || a.x - b.x);
	let s = beginStroke(state);
	for (const { x, y } of pixels) s = paintWithInk(s, x, y, ink);

	if (ink.kind === 'transparent')
		for (const id of stampCells) {
			const [cx, cy] = id.split(',').map(Number);
			s = paintWithInk(s, cx * 2, cy * 2, ink);
		}
	s = endStroke(s);
	if (s.doc === state.doc) return { ...s, feedback: '' };
	const parts: string[] = [];
	if (pixels.length > 0)
		parts.push(
			`filled ${pixels.length} Pixel${pixels.length === 1 ? '' : 's'}`,
		);
	const stamps = ink.kind === 'transparent' ? stampCells.size : 0;
	if (stamps > 0)
		parts.push(`cleared ${stamps} stamp${stamps === 1 ? '' : 's'}`);
	return { ...s, feedback: parts.join(', ') };
}

export function floodFill(
	state: SpriteEditorState,
	px: number,
	py: number,
	ink: Ink,
): SpriteEditorState {
	const { w, h } = frameExtent(currentFrame(state));
	const pw = w * 2;
	const ph = h * 2;
	if (px < 0 || py < 0 || px >= pw || py >= ph)
		return refuse(state, 'clipped — nothing to fill past the canvas edge');

	const cellId = (cx: number, cy: number) => `${cx},${cy}`;
	const seed = pixelClass(state, px, py);

	if (seed.wall) {
		if (ink.kind !== 'transparent')
			return refuse(state, 'fill skipped the glyph stamp');
		const { cellX, cellY } = pixelToCell(px, py);
		return applyFill(state, [], new Set([cellId(cellX, cellY)]), ink);
	}

	const target = seed.key;
	const visited = new Set<string>([`${px},${py}`]);
	const region: { x: number; y: number }[] = [];
	const stampCells = new Set<string>();
	const stack: { x: number; y: number }[] = [{ x: px, y: py }];
	while (stack.length > 0) {
		const p = stack.pop() as { x: number; y: number };
		region.push(p);
		for (const [nx, ny] of [
			[p.x - 1, p.y],
			[p.x + 1, p.y],
			[p.x, p.y - 1],
			[p.x, p.y + 1],
		] as const) {
			if (nx < 0 || ny < 0 || nx >= pw || ny >= ph) continue;
			const id = `${nx},${ny}`;
			if (visited.has(id)) continue;
			visited.add(id);
			const cls = pixelClass(state, nx, ny);
			if (cls.wall) {
				const { cellX, cellY } = pixelToCell(nx, ny);
				stampCells.add(cellId(cellX, cellY));
				continue;
			}
			if (cls.key === target) stack.push({ x: nx, y: ny });
		}
	}
	return applyFill(state, region, stampCells, ink);
}

export function linePixels(a: Point, b: Point): Point[] {
	let x0 = a.x;
	let y0 = a.y;
	const dx = Math.abs(b.x - x0);
	const dy = -Math.abs(b.y - y0);
	const sx = x0 < b.x ? 1 : -1;
	const sy = y0 < b.y ? 1 : -1;
	let err = dx + dy;
	const out: Point[] = [];
	while (true) {
		out.push({ x: x0, y: y0 });
		if (x0 === b.x && y0 === b.y) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
	}
	return out;
}

function bbox(
	a: Point,
	b: Point,
): { x0: number; y0: number; x1: number; y1: number } {
	return {
		x0: Math.min(a.x, b.x),
		y0: Math.min(a.y, b.y),
		x1: Math.max(a.x, b.x),
		y1: Math.max(a.y, b.y),
	};
}

export function rectPixels(a: Point, b: Point, filled: boolean): Point[] {
	const { x0, y0, x1, y1 } = bbox(a, b);
	const out: Point[] = [];
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const edge = x === x0 || x === x1 || y === y0 || y === y1;
			if (filled || edge) out.push({ x, y });
		}
	return out;
}

export function ellipsePixels(a: Point, b: Point, filled: boolean): Point[] {
	const { x0, y0, x1, y1 } = bbox(a, b);
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	const rx = (x1 - x0) / 2;
	const ry = (y1 - y0) / 2;

	if (rx === 0 || ry === 0) return rectPixels(a, b, true);
	const inside = (x: number, y: number): boolean =>
		((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + 1e-9;
	const out: Point[] = [];
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			if (!inside(x, y)) continue;
			if (filled) {
				out.push({ x, y });
				continue;
			}

			if (
				!inside(x - 1, y) ||
				!inside(x + 1, y) ||
				!inside(x, y - 1) ||
				!inside(x, y + 1)
			)
				out.push({ x, y });
		}
	return out;
}

export function constrainSquare(anchor: Point, to: Point): Point {
	const dx = to.x - anchor.x;
	const dy = to.y - anchor.y;
	const sx = dx < 0 ? -1 : 1;
	const sy = dy < 0 ? -1 : 1;
	const h = Math.max(Math.abs(dy), Math.round(Math.abs(dx) / 2));
	return { x: anchor.x + sx * 2 * h, y: anchor.y + sy * h };
}

function shapeMode(state: SpriteEditorState, tool: ShapeTool): ShapeMode {
	if (tool === 'rect') return state.rectMode;
	if (tool === 'ellipse') return state.ellipseMode;
	return 'outline';
}

function rasterShape(
	tool: ShapeTool,
	anchor: Point,
	to: Point,
	filled: boolean,
): Point[] {
	if (tool === 'line') return linePixels(anchor, to);
	if (tool === 'rect') return rectPixels(anchor, to, filled);
	return ellipsePixels(anchor, to, filled);
}

function resolveShape(state: SpriteEditorState): {
	inside: Point[];
	clipped: number;
} {
	const shape = state.shape;
	if (!shape) return { inside: [], clipped: 0 };
	const to = shape.constrain
		? constrainSquare(shape.anchor, shape.to)
		: shape.to;

	const raw =
		shape.tool === 'select'
			? rectPixels(shape.anchor, to, false)
			: rasterShape(
					shape.tool,
					shape.anchor,
					to,
					shapeMode(state, shape.tool) === 'filled',
				);
	const { w, h } = frameExtent(currentFrame(state));
	const maxX = w * 2;
	const maxY = h * 2;
	const inside = raw.filter(
		(p) => p.x >= 0 && p.y >= 0 && p.x < maxX && p.y < maxY,
	);
	return { inside, clipped: raw.length - inside.length };
}

function paintBatch(
	state: SpriteEditorState,
	pixels: readonly Point[],
	ink: Ink,
): SpriteEditorState {
	const tag = state.stroke ?? `shape${state.strokeSeq + 1}`;
	let s: SpriteEditorState = { ...state, stroke: tag };
	for (const p of pixels) s = paintWithInk(s, p.x, p.y, ink);
	return {
		...s,
		stroke: state.stroke,
		strokeSeq: state.stroke ? state.strokeSeq : state.strokeSeq + 1,
	};
}

export function beginShape(
	state: SpriteEditorState,
	tool: AnchorTool,
	px: number,
	py: number,
	ink: Ink,
	constrain = false,
): SpriteEditorState {
	const anchor = { x: px, y: py };
	return {
		...state,
		cursor: { x: Math.max(0, px), y: Math.max(0, py) },
		shape: { tool, anchor, to: anchor, constrain, ink },
		feedback: '',
	};
}

export function updateShape(
	state: SpriteEditorState,
	px: number,
	py: number,
	constrain = false,
): SpriteEditorState {
	if (!state.shape) return state;
	return {
		...state,
		cursor: { x: Math.max(0, px), y: Math.max(0, py) },
		shape: { ...state.shape, to: { x: px, y: py }, constrain },
	};
}

export function shapePreviewPixels(state: SpriteEditorState): Point[] {
	return resolveShape(state).inside;
}

export function commitShape(state: SpriteEditorState): SpriteEditorState {
	if (!state.shape) return state;
	const ink = state.shape.ink;
	const { inside, clipped } = resolveShape(state);
	const cleared: SpriteEditorState = { ...state, shape: null };
	const painted = paintBatch(cleared, inside, ink);
	const note = clipped > 0 ? `clipped ${clipped} px past the canvas edge` : '';
	return { ...painted, feedback: note };
}

export function cancelShape(state: SpriteEditorState): SpriteEditorState {
	if (!state.shape) return state;
	return { ...state, shape: null, feedback: '' };
}

export function toggleShapeMode(state: SpriteEditorState): SpriteEditorState {
	if (state.tool === 'rect')
		return {
			...state,
			rectMode: state.rectMode === 'outline' ? 'filled' : 'outline',
			feedback: '',
		};
	if (state.tool === 'ellipse')
		return {
			...state,
			ellipseMode: state.ellipseMode === 'outline' ? 'filled' : 'outline',
			feedback: '',
		};
	return { ...state, feedback: 'the line tool has no fill mode' };
}

export function pencilLineTo(
	state: SpriteEditorState,
	px: number,
	py: number,
	ink: Ink,
): SpriteEditorState {
	const from = state.lastPaint;
	const pixels = from ? linePixels(from, { x: px, y: py }) : [{ x: px, y: py }];
	const painted = paintBatch(state, pixels, ink);
	return { ...painted, lastPaint: { x: px, y: py } };
}

export function makeSelection(
	state: SpriteEditorState,
	a: Point,
	b: Point,
): Selection {
	const { w, h } = frameExtent(currentFrame(state));
	const clampX = (v: number) =>
		Math.max(0, Math.min(Math.max(0, w * 2 - 1), v));
	const clampY = (v: number) =>
		Math.max(0, Math.min(Math.max(0, h * 2 - 1), v));
	return {
		x0: clampX(Math.min(a.x, b.x)),
		y0: clampY(Math.min(a.y, b.y)),
		x1: clampX(Math.max(a.x, b.x)),
		y1: clampY(Math.max(a.y, b.y)),
	};
}

export function setSelection(
	state: SpriteEditorState,
	sel: Selection | null,
): SpriteEditorState {
	return { ...state, selection: sel, feedback: '' };
}

export function selectAll(state: SpriteEditorState): SpriteEditorState {
	const { w, h } = frameExtent(currentFrame(state));
	if (w === 0 || h === 0) return { ...state, selection: null };
	return {
		...state,
		selection: { x0: 0, y0: 0, x1: w * 2 - 1, y1: h * 2 - 1 },
		feedback: '',
	};
}

export function clearSelection(state: SpriteEditorState): SpriteEditorState {
	if (state.float) return state;
	return { ...state, selection: null, feedback: '' };
}

export function pendingSelectionRect(
	state: SpriteEditorState,
): Selection | null {
	const shape = state.shape;
	if (shape?.tool !== 'select') return null;
	return makeSelection(state, shape.anchor, shape.to);
}

export function commitSelection(state: SpriteEditorState): SpriteEditorState {
	const shape = state.shape;
	if (shape?.tool !== 'select') return state;
	const selection = makeSelection(state, shape.anchor, shape.to);
	return { ...state, shape: null, selection, feedback: '' };
}

export function selectionContains(
	sel: Selection,
	px: number,
	py: number,
): boolean {
	return px >= sel.x0 && px <= sel.x1 && py >= sel.y0 && py <= sel.y1;
}

export function selectionOverlay(state: SpriteEditorState): Selection | null {
	const f = state.float;
	if (f)
		return {
			x0: f.source.x0 + f.dx,
			y0: f.source.y0 + f.dy,
			x1: f.source.x1 + f.dx,
			y1: f.source.y1 + f.dy,
		};
	return state.selection;
}

function liftContent(
	state: SpriteEditorState,
	sel: Selection,
): { pixels: FloatPixel[]; stamps: FloatStamp[] } {
	const pixels: FloatPixel[] = [];
	for (let y = sel.y0; y <= sel.y1; y++)
		for (let x = sel.x0; x <= sel.x1; x++) {
			const { cellX, cellY, bit } = pixelToCell(x, y);
			const cell = cellAt(state, cellX, cellY);
			if (cell.mask === undefined) continue;
			if ((cell.mask & (1 << bit)) === 0) continue;
			const key =
				cell.fg === SENTINEL || cell.fg === '' ? state.doc.key : cell.fg;
			pixels.push({ x, y, key });
		}
	const stamps: FloatStamp[] = [];
	const { w, h } = frameExtent(currentFrame(state));
	for (let cy = Math.floor(sel.y0 / 2); cy <= Math.floor(sel.y1 / 2); cy++)
		for (let cx = Math.floor(sel.x0 / 2); cx <= Math.floor(sel.x1 / 2); cx++) {
			if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;

			if (2 * cx < sel.x0 || 2 * cx + 1 > sel.x1) continue;
			if (2 * cy < sel.y0 || 2 * cy + 1 > sel.y1) continue;
			const cell = cellAt(state, cx, cy);
			if (cell.mask !== undefined || cell.glyph === ' ') continue;
			const fg = cell.fg === '' ? state.doc.key : cell.fg;
			stamps.push({ cellX: cx, cellY: cy, glyph: cell.glyph, fg });
		}
	return { pixels, stamps };
}

export function beginFloat(
	state: SpriteEditorState,
	grab?: Point,
): SpriteEditorState {
	if (state.float) return state;
	const sel = state.selection;
	if (!sel) return refuse(state, 'select something to move first');
	const { pixels, stamps } = liftContent(state, sel);
	return {
		...state,
		float: {
			pixels,
			stamps,
			source: sel,
			grab: grab ?? { x: sel.x0, y: sel.y0 },
			dx: 0,
			dy: 0,
		},
		feedback: '',
	};
}

export function moveFloatTo(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	if (!state.float) return state;
	return {
		...state,
		float: {
			...state.float,
			dx: px - state.float.grab.x,
			dy: py - state.float.grab.y,
		},
	};
}

export function nudgeFloat(
	state: SpriteEditorState,
	dx: number,
	dy: number,
): SpriteEditorState {
	let s = state;
	if (!s.float) {
		s = beginFloat(s);
		if (!s.float) return s;
	}
	return {
		...s,
		float: { ...s.float, dx: s.float.dx + dx, dy: s.float.dy + dy },
		feedback: '',
	};
}

function bakeFloat(state: SpriteEditorState): {
	doc: SpriteDoc;
	clipped: number;
} {
	const float = state.float;
	if (!float) return { doc: state.doc, clipped: 0 };
	const { w, h } = frameExtent(currentFrame(state));
	let s: SpriteEditorState = state;

	if (float.lifted !== false) {
		for (const p of float.pixels) s = punchTransparent(s, p.x, p.y);
		for (const st of float.stamps)
			s = commitQuadrant(s, st.cellX, st.cellY, 0, '', '', '');
	}

	let clipped = 0;
	for (const p of float.pixels) {
		const lx = p.x + float.dx;
		const ly = p.y + float.dy;
		if (lx < 0 || ly < 0 || lx >= w * 2 || ly >= h * 2) {
			clipped++;
			continue;
		}
		s = paintColor(s, lx, ly, p.key);
	}
	for (const st of float.stamps) {
		const cx = st.cellX + Math.round(float.dx / 2);
		const cy = st.cellY + Math.round(float.dy / 2);
		if (cx < 0 || cy < 0 || cx >= w || cy >= h) {
			clipped++;
			continue;
		}

		s = commitFrame(
			s,
			writeCell(currentFrame(s), cx, cy, st.glyph, st.fg, ' '),
		);
	}
	return { doc: s.doc, clipped };
}

export function floatDisplayDoc(state: SpriteEditorState): SpriteDoc {
	if (!state.float) return state.doc;
	return bakeFloat(state).doc;
}

export function commitFloat(state: SpriteEditorState): SpriteEditorState {
	const float = state.float;
	if (!float) return state;

	if (float.dx === 0 && float.dy === 0 && float.lifted !== false)
		return { ...state, float: null, selection: float.source, feedback: '' };
	const { doc, clipped } = bakeFloat(state);
	const landed = makeSelection(
		state,
		{ x: float.source.x0 + float.dx, y: float.source.y0 + float.dy },
		{ x: float.source.x1 + float.dx, y: float.source.y1 + float.dy },
	);
	const tag = `float${state.strokeSeq + 1}`;
	return {
		...state,
		doc,
		history: record(state.history, doc, tag),
		strokeSeq: state.strokeSeq + 1,
		float: null,
		selection: landed,
		feedback: clipped > 0 ? `clipped ${clipped} past the canvas edge` : '',
	};
}

export function cancelFloat(state: SpriteEditorState): SpriteEditorState {
	if (!state.float) return state;
	return { ...state, float: null, feedback: '' };
}

export function deleteSelection(state: SpriteEditorState): SpriteEditorState {
	const sel = state.selection;
	if (!sel) return refuse(state, 'nothing selected to delete');
	const { pixels, stamps } = liftContent(state, sel);
	if (pixels.length === 0 && stamps.length === 0)
		return { ...state, feedback: '' };
	let s: SpriteEditorState = state;
	for (const p of pixels) s = punchTransparent(s, p.x, p.y);
	for (const st of stamps)
		s = commitQuadrant(s, st.cellX, st.cellY, 0, '', '', '');
	const tag = `delete${state.strokeSeq + 1}`;
	return {
		...state,
		doc: s.doc,
		history: record(state.history, s.doc, tag),
		strokeSeq: state.strokeSeq + 1,
		feedback: 'cleared selection',
	};
}

export function copySelection(state: SpriteEditorState): SpriteEditorState {
	const sel = state.selection;
	if (!sel) return refuse(state, 'select something to copy first');
	const { pixels, stamps } = liftContent(state, sel);
	return {
		...state,
		clipboard: { pixels, stamps, source: sel },
		feedback: 'copied selection',
	};
}

export function cutSelection(state: SpriteEditorState): SpriteEditorState {
	const sel = state.selection;
	if (!sel) return refuse(state, 'select something to cut first');
	const { pixels, stamps } = liftContent(state, sel);
	const copied: SpriteEditorState = {
		...state,
		clipboard: { pixels, stamps, source: sel },
	};
	return { ...deleteSelection(copied), feedback: 'cut selection' };
}

export function pasteFromClipboard(
	state: SpriteEditorState,
): SpriteEditorState {
	if (state.float) return state;
	const clip = state.clipboard;
	if (!clip) return refuse(state, 'clipboard is empty — copy or cut first');
	return {
		...state,
		selection: clip.source,
		float: {
			pixels: clip.pixels,
			stamps: clip.stamps,
			source: clip.source,
			grab: { x: clip.source.x0, y: clip.source.y0 },
			dx: 0,
			dy: 0,
			lifted: false,
		},
		feedback: 'pasted — drag or arrows to place, Enter to drop',
	};
}

export function stampGlyph(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
	char: string,
): SpriteEditorState {
	if (cellX < 0 || cellY < 0)
		return refuse(state, 'cannot stamp outside the canvas');
	if ([...char].length !== 1)
		return refuse(state, 'a stamp is a single character');
	if (char === SENTINEL || char === ' ')
		return refuse(state, 'use clearCell to empty a cell');

	const fgChar = inkColorKey(state.ink) ?? state.doc.key;
	const frame = writeCell(currentFrame(state), cellX, cellY, char, fgChar, ' ');
	return commitFrame(state, frame);
}

export function clearCell(
	state: SpriteEditorState,
	cellX: number,
	cellY: number,
): SpriteEditorState {
	const cell = cellAt(state, cellX, cellY);
	if (cell.glyph === ' ' && cell.bg === '') return { ...state, feedback: '' };
	const frame = writeCell(currentFrame(state), cellX, cellY, ' ', ' ', ' ');
	return commitFrame(state, frame);
}

function validRgba(v: unknown): v is RGBAQuad {
	return (
		Array.isArray(v) &&
		v.length === 4 &&
		v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
	);
}

export function defineLocalColor(
	state: SpriteEditorState,
	key: string,
	rgba: RGBAQuad,
): SpriteEditorState {
	if (RESERVED_KEYS.has(key))
		return refuse(
			state,
			`'${key}' is a reserved dynamic key and cannot be defined`,
		);
	if (key.length !== 1)
		return refuse(state, 'a color key must be a single character');
	if (key === SENTINEL || key === ' ')
		return refuse(state, `'${key}' cannot be a color key`);
	if (!validRgba(rgba))
		return refuse(state, 'a color must be [r,g,b,a] with each 0..255');
	const nextDoc: SpriteDoc = {
		...state.doc,
		colors: { ...state.doc.colors, [key]: rgba },
	};
	return commitDoc(state, nextDoc);
}

export function paletteEntries(
	state: SpriteEditorState,
	globalPalette: Record<string, RGBAQuad>,
	previews: DynamicPreviews,
): PaletteEntry[] {
	const entries: PaletteEntry[] = [];
	for (const [key, rgba] of Object.entries(state.doc.colors))
		entries.push({ key, rgba, label: key, kind: 'local' });
	for (const [key, rgba] of Object.entries(globalPalette)) {
		if (RESERVED_KEYS.has(key)) continue;
		entries.push({ key, rgba, label: key, kind: 'palette' });
	}
	entries.push({
		key: 'p',
		rgba: previews.p,
		label: 'player hue',
		kind: 'dynamic',
	});
	entries.push({
		key: 'a',
		rgba: previews.a,
		label: 'weapon accent',
		kind: 'dynamic',
	});
	return entries;
}

function sampleKey(state: SpriteEditorState, key: string): SpriteEditorState {
	const resolved = key === SENTINEL ? state.doc.key : key;
	if (!validKey(resolved))
		return { ...state, feedback: 'nothing to sample here' };
	return {
		...state,
		ink: colorInk(resolved),
		feedback: `sampled '${resolved}'`,
	};
}

export function eyedropAt(
	state: SpriteEditorState,
	px: number,
	py: number,
): SpriteEditorState {
	if (px < 0 || py < 0)
		return { ...state, feedback: 'nothing to sample past the canvas edge' };
	const { cellX, cellY, bit } = pixelToCell(px, py);
	const cell = cellAt(state, cellX, cellY);

	if (cell.mask === undefined) return sampleKey(state, cell.fg);
	const lit = (cell.mask & (1 << bit)) !== 0;
	if (lit) return sampleKey(state, cell.fg);

	if (cell.bg !== '' && cell.bg !== SENTINEL) return sampleKey(state, cell.bg);
	return { ...state, ink: TRANSPARENT_INK, feedback: 'sampled transparent' };
}

function clampCursor(state: SpriteEditorState): SpriteEditorState {
	const { w, h } = frameExtent(currentFrame(state));
	const cx = Math.max(0, Math.min(Math.max(0, w * 2 - 1), state.cursor.x));
	const cy = Math.max(0, Math.min(Math.max(0, h * 2 - 1), state.cursor.y));
	if (cx === state.cursor.x && cy === state.cursor.y) return state;
	return { ...state, cursor: { x: cx, y: cy } };
}

export function resizeCanvas(
	state: SpriteEditorState,
	modal: CanvasModal,
): SpriteEditorState {
	const nextDoc = applyCanvasModal(state.doc, modal);
	if (!nextDoc) return refuse(state, 'cannot shrink below 1×1');
	if (nextDoc === state.doc) return { ...state, feedback: '' };
	const committed = commitDoc(state, nextDoc);
	const { w, h } = frameExtent(currentFrame(committed));
	return { ...clampCursor(committed), feedback: `canvas ${w}×${h}` };
}

export function undoEdit(state: SpriteEditorState): SpriteEditorState {
	if (!canUndo(state.history)) return { ...state, feedback: '' };
	const history = undo(state.history);
	return {
		...state,
		history,
		doc: history.present,
		stroke: null,
		feedback: '',
	};
}

export function redoEdit(state: SpriteEditorState): SpriteEditorState {
	if (!canRedo(state.history)) return { ...state, feedback: '' };
	const history = redo(state.history);
	return {
		...state,
		history,
		doc: history.present,
		stroke: null,
		feedback: '',
	};
}

export function saveResult(state: SpriteEditorState): {
	text: string;
	diagnostics: SpriteDiagnostic[];
} {
	const text = serializeSpriteFile(trimDoc(state.doc));

	const { diagnostics } = parseSpriteFile(text, state.doc.id);
	return { text, diagnostics };
}

export { DEFAULT_KEY as SPRITE_DEFAULT_KEY };
