// The editor chrome's pure models (spec #387, layout locked by prototype #375):
// the 30-column left rail (tools · ink · playback boxes), the context-sensitive
// bottom hint line, and the `?` overlay's grouped key map. Everything here is a
// deterministic function of the pure editor state — `tui.ts` only draws the
// rows and routes clicks back through the returned actions, so the rail's
// content and hit-targets are unit-testable without a screen.
import type { RGBAQuad } from '@mmo/core/entities';
import type { Ink, PaletteEntry, SpriteTool } from './state';

// The rail's total width in columns, divider included (locked by #375).
export const RAIL_W = 30;

// ---------------------------------------------------------------------------
// Rail actions — what a click on a rail row means
// ---------------------------------------------------------------------------

export type RailAction =
	| { readonly type: 'tool'; readonly tool: SpriteTool }
	| { readonly type: 'ink'; readonly ink: Ink }
	| { readonly type: 'pickInk' }
	| { readonly type: 'play'; readonly mode: 'pose' | 'walk' }
	| { readonly type: 'addFrame' }
	| { readonly type: 'poseMenu' }
	| { readonly type: 'anchorMenu' };

// One styled run of text on a rail row. `swatch` colours the run's BACKGROUND
// (an ink sample); 'checker' is the transparent swatch. A run with an action is
// a click target across its rendered extent.
export interface RailSpan {
	readonly text: string;
	readonly hot?: boolean;
	readonly dim?: boolean;
	readonly swatch?: RGBAQuad | 'checker';
	readonly action?: RailAction;
}

export interface RailRow {
	readonly spans: readonly RailSpan[];
	readonly title?: boolean;
}

// The tools the rail offers today, in rail order with their number-row keys
// (spec #387: tools live on the number row in rail order — pencil, fill, stamp,
// line, rect, ellipse, select, move, paste; erase is demoted to the right
// button, off the rail, and the anchor tool moved off the number row — it lives
// in the playback box's `A anchor` and the `a` key. Select (7)/move (8) are live
// (#399); paste (9) is a TRIGGER — clicking it or pressing 9 spawns a paste float
// and hands off to move, never resting as the active tool (#400).
// Every glyph must be ONE code unit and ONE terminal column: the rail's
// hit-testing walks span.text.length, so a double-width (or ambiguous-width)
// glyph would desync every mouse column to its right. ○ is U+25CB (never the
// ambiguous-width ◯ U+25EF) and ✜ is distinct from the anchor marker ✛.
// Eyeball the set in a real terminal with `forge sprite glyphs`.
export const RAIL_TOOLS: readonly {
	key: string;
	tool: SpriteTool;
	glyph: string;
	label: string;
}[] = [
	{ key: '1', tool: 'paint', glyph: '✎', label: 'pencil' },
	{ key: '2', tool: 'fill', glyph: '▓', label: 'fill' },
	{ key: '3', tool: 'stamp', glyph: '▣', label: 'stamp' },
	{ key: '4', tool: 'line', glyph: '╱', label: 'line' },
	{ key: '5', tool: 'rect', glyph: '▭', label: 'rect' },
	{ key: '6', tool: 'ellipse', glyph: '○', label: 'ellipse' },
	{ key: '7', tool: 'select', glyph: '↖', label: 'select' },
	{ key: '8', tool: 'move', glyph: '✜', label: 'move' },
	{ key: '9', tool: 'paste', glyph: '⧉', label: 'paste' },
];

// Substitutes for the glyphs most likely to render as tofu in a spartan font,
// kept width-safe under the same rules. Swap one in by editing RAIL_TOOLS after
// checking `forge sprite glyphs` in the target terminal.
export const TOOL_GLYPH_FALLBACKS: Readonly<Record<string, string>> = {
	select: '⌖',
	move: '⇄',
	paste: '▤',
};

export interface RailInput {
	readonly tool: SpriteTool;
	readonly ink: Ink;
	// Everything paintable, from paletteEntries() — locals, palette, dynamics.
	readonly entries: readonly PaletteEntry[];
	readonly pose: string;
	readonly fps: number;
	readonly frameCount: number;
	readonly playMode: 'none' | 'pose' | 'walk';
	// Onion-skin depth (0 off), surfaced in the playback box.
	readonly onionDepth: number;
	// Rows available for the rail (the canvas region's height).
	readonly height: number;
	// Small-terminal rung 3 (spec #387): fold the playback box to a single hint
	// row so the ink list keeps room. Decided by the degradation solver.
	readonly foldPlayback?: boolean;
}

// One ink the rail lists: a palette entry, or the transparent pseudo-entry.
type InkOption =
	| { kind: 'entry'; entry: PaletteEntry }
	| { kind: 'transparent' };

function inkOptions(entries: readonly PaletteEntry[]): InkOption[] {
	return [
		...entries.map((entry) => ({ kind: 'entry', entry }) as InkOption),
		{ kind: 'transparent' },
	];
}

function optionMatches(o: InkOption, ink: Ink): boolean {
	if (o.kind === 'transparent') return ink.kind === 'transparent';
	return ink.kind === 'color' && ink.key === o.entry.key;
}

function inkRow(o: InkOption, active: boolean): RailRow {
	const mark = active ? '▸' : ' ';
	if (o.kind === 'transparent') {
		const action: RailAction = { type: 'ink', ink: { kind: 'transparent' } };
		return {
			spans: [
				{ text: `${mark} `, hot: active, action },
				{ text: '▚▚', swatch: 'checker', action },
				{ text: ' t transparent', hot: active, dim: !active, action },
			],
		};
	}
	const e = o.entry;
	const action: RailAction = {
		type: 'ink',
		ink: { kind: 'color', key: e.key },
	};
	const tag =
		e.kind === 'dynamic' ? ` ${e.label}` : e.kind === 'local' ? ' local' : '';
	return {
		spans: [
			{ text: `${mark} `, hot: active, action },
			{ text: '  ', swatch: e.rgba, action },
			{ text: ` ${e.key}${tag}`, hot: active, dim: !active, action },
		],
	};
}

// Build the rail's rows for the given editor moment. Rows beyond `height` are
// the caller's to clip; the ink list windows itself around the active ink so
// the playback box always fits (small-terminal folding is a later slice).
export function railModel(input: RailInput): RailRow[] {
	const rows: RailRow[] = [];

	// --- tools box: two tools per row, the active one hot ---
	rows.push({ spans: [{ text: ' tools', dim: true }], title: true });
	for (let i = 0; i < RAIL_TOOLS.length; i += 2) {
		const spans: RailSpan[] = [{ text: ' ' }];
		for (const t of RAIL_TOOLS.slice(i, i + 2)) {
			const active = t.tool === input.tool;
			spans.push({
				text: `${active ? '▸' : ' '}${t.key} ${t.glyph} ${t.label}`.padEnd(14),
				hot: active,
				action: { type: 'tool', tool: t.tool },
			});
		}
		rows.push({ spans });
	}
	rows.push({ spans: [{ text: '' }] });

	// --- ink box: a window of the ink list centred on the active ink ---
	rows.push({
		spans: [
			{ text: ' ink', dim: true },
			{ text: '  c pick · i eye', dim: true, action: { type: 'pickInk' } },
		],
		title: true,
	});
	const options = inkOptions(input.entries);
	const activeIdx = Math.max(
		0,
		options.findIndex((o) => optionMatches(o, input.ink)),
	);
	// The playback box is built first so the ink window's row budget is derived
	// from its real size, never a hand-counted constant. When the degradation
	// solver folds it (rung 3), it is a single hint row and the freed rows fall
	// to the ink list automatically through the budget below.
	const playback = input.foldPlayback
		? foldedPlaybackBox(input)
		: playbackBox(input);
	// Rows left for inks after everything fixed: the boxes above, the blank
	// separating ink from playback, and the playback box itself.
	const avail = Math.max(1, input.height - (rows.length + 1 + playback.length));
	// The visible window [lo, hi) of the ink list, centred on the active ink.
	// When clipped, the edge rows become markers stating exactly how many inks
	// each hides; below 3 rows there is no room for honest markers, so the
	// window clips silently (the small-terminal slice owns that regime).
	let lo = 0;
	let hi = options.length;
	if (options.length > avail) {
		lo = Math.min(
			Math.max(0, activeIdx - Math.floor(avail / 2)),
			options.length - avail,
		);
		hi = lo + avail;
		if (avail >= 3) {
			if (lo > 0) lo += 1;
			if (hi < options.length) hi -= 1;
			// Keep the active ink visible when it sat on a marker's row.
			if (activeIdx < lo) {
				lo -= 1;
				hi -= 1;
			} else if (activeIdx >= hi) {
				lo += 1;
				hi += 1;
			}
		}
	}
	if (lo > 0) rows.push({ spans: [{ text: `   ↑ ${lo} more`, dim: true }] });
	for (let i = lo; i < hi; i++) rows.push(inkRow(options[i], i === activeIdx));
	if (hi < options.length)
		rows.push({
			spans: [{ text: `   ↓ ${options.length - hi} more`, dim: true }],
		});
	rows.push({ spans: [{ text: '' }] });

	rows.push(...playback);
	return rows;
}

function playbackBox(input: RailInput): RailRow[] {
	return [
		{ spans: [{ text: ' playback', dim: true }], title: true },
		{
			spans: [
				{
					text: ` pose ${input.pose} · ${input.fps}fps · ${input.frameCount}f`,
					dim: true,
				},
			],
		},
		{
			spans: [
				{ text: ' ' },
				{
					text: input.playMode === 'pose' ? '▶ . pose' : '  . pose',
					hot: input.playMode === 'pose',
					action: { type: 'play', mode: 'pose' },
				},
				{ text: '  ' },
				{
					text: input.playMode === 'walk' ? '▶ , walk' : '  , walk',
					hot: input.playMode === 'walk',
					action: { type: 'play', mode: 'walk' },
				},
				{ text: '  ' },
				{
					text: `O ${input.onionDepth}`,
					hot: input.onionDepth > 0,
					dim: input.onionDepth === 0,
				},
			],
		},
		{ spans: [{ text: ' [ ] frame · { } pose', dim: true }] },
		{
			spans: [
				{ text: ' ' },
				{ text: 'n +frame', dim: true, action: { type: 'addFrame' } },
				{ text: ' · ' },
				{ text: 'P pose', dim: true, action: { type: 'poseMenu' } },
				{ text: ' · ' },
				{ text: 'A anchor', dim: true, action: { type: 'anchorMenu' } },
			],
		},
	];
}

// The folded playback box (spec #387 rung 3): one hint row standing in for the
// full box when the rail can't fit both boxes. Keeps the most-used controls —
// play and add-Frame — clickable; the fps/pose/onion detail is dropped until the
// terminal grows back and the full box returns.
function foldedPlaybackBox(input: RailInput): RailRow[] {
	const playing = input.playMode === 'pose';
	return [
		{
			title: true,
			spans: [
				{ text: ' playback', dim: true },
				{ text: '  ' },
				{
					text: playing ? '▶ . play' : '. play',
					hot: playing,
					action: { type: 'play', mode: 'pose' },
				},
				{ text: ' · ' },
				{ text: 'n +f', dim: true, action: { type: 'addFrame' } },
			],
		},
	];
}

// The action a click at rail cell (x, y) triggers, if any. `y` indexes the
// rendered rows; `x` walks the row's spans by their rendered widths.
export function railActionAt(
	rows: readonly RailRow[],
	x: number,
	y: number,
): RailAction | undefined {
	const row = rows[y];
	if (!row) return undefined;
	let x0 = 0;
	for (const span of row.spans) {
		const x1 = x0 + span.text.length;
		if (x >= x0 && x < x1 && span.action) return span.action;
		x0 = x1;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Help surface (spec #387): a context-sensitive hint line — the globals plus
// the active tool's keys — and the `?` overlay's complete grouped map.
// ---------------------------------------------------------------------------

export interface KeyBinding {
	readonly keys: string;
	readonly label: string;
}

export interface KeymapGroup {
	readonly title: string;
	readonly bindings: readonly KeyBinding[];
}

// The complete key map, grouped for the `?` overlay. This is the single source
// of truth for what the editor binds; the hint line draws from it too.
export const SPRITE_KEYMAP: readonly KeymapGroup[] = [
	{
		title: 'Tools',
		bindings: [
			{
				keys: '1-9',
				label:
					'pencil · fill · stamp · line · rect · ellipse · select · move · paste',
			},
			{ keys: 'p s / a', label: 'pencil · stamp / anchor (letters)' },
			{ keys: 'o', label: 'rect/ellipse outline ↔ filled' },
		],
	},
	{
		title: 'Global',
		bindings: [
			{ keys: '?', label: 'this help' },
			{ keys: 'tab', label: 'strips ↔ focus view' },
			{ keys: '^s / w', label: 'save' },
			{ keys: 'u / U', label: 'undo / redo (^z / ^r)' },
			{ keys: '+ / -', label: 'zoom ladder (ctrl-wheel too)' },
			{ keys: 'm', label: 'mirror facing' },
			{ keys: 'v', label: 'composited preview' },
			{ keys: 'q', label: 'quit' },
		],
	},
	{
		title: 'Cursor & paint',
		bindings: [
			{ keys: 'arrows / hjkl', label: 'move cursor 1 Pixel' },
			{ keys: 'space', label: 'pen down/up (movement paints)' },
			{ keys: 'left / right click', label: 'paint ink / paint transparent' },
			{ keys: 'shift-click', label: 'pencil: line from last point' },
			{ keys: 'enter / drag', label: 'shape anchor / commit (shift squares)' },
			{ keys: 'esc', label: 'cancel shape / float / overlay / stamp' },
		],
	},
	{
		title: 'Selection & move',
		bindings: [
			{ keys: '7 / 8 / 9', label: 'select marquee / move (float) / paste' },
			{ keys: 'drag / arrows', label: 'lift + float the selection' },
			{ keys: 'enter / esc', label: 'drop float / cancel losslessly' },
			{ keys: 'y / x', label: 'copy / cut selection' },
			{ keys: 'del / bksp', label: 'clear selection contents (delete)' },
			{ keys: 'shift-arrows', label: 'shift the whole Frame 1 Pixel' },
		],
	},
	{
		title: 'Color',
		bindings: [
			{ keys: 'e', label: 'define / edit file-local colour (modal)' },
			{ keys: 'c', label: 'ink quick-pick (type / arrows / index)' },
			{ keys: "; / '", label: 'nudge ink to the adjacent swatch' },
			{ keys: 't', label: 'set ink transparent' },
			{ keys: 'i', label: 'eyedrop key (alt-click momentary)' },
		],
	},
	{
		title: 'Frames & poses',
		bindings: [
			{ keys: '[ ] / { }', label: 'prev / next frame · pose' },
			{ keys: 'n', label: 'add frame to current pose' },
			{ keys: 'P / A', label: 'pose menu / anchor menu' },
			{ keys: '. / ,', label: 'play pose / walk preview' },
			{ keys: 'O', label: 'onion skin depth 0/1/2' },
		],
	},
	{
		title: 'Resize & crop',
		bindings: [
			{ keys: 'R', label: 'resize mode (tab edge · arrows · enter/esc)' },
			{ keys: 'C', label: 'crop to selection' },
		],
	},
	{
		title: 'Navigation',
		bindings: [
			{ keys: 'wheel', label: 'scroll strips' },
			{ keys: 'shift-wheel', label: 'scroll horizontally' },
			{ keys: 'ctrl-wheel', label: 'zoom' },
			{ keys: 'middle-drag', label: 'pan · click-through activates frame' },
		],
	},
];

// The `?` overlay's rows: each group a title row then its bindings, keys
// left-padded into a fixed column so the labels align.
export function helpRows(): string[] {
	const keyW = Math.max(
		...SPRITE_KEYMAP.flatMap((g) => g.bindings.map((b) => b.keys.length)),
	);
	const rows: string[] = ['Key map (? or esc closes)', ''];
	for (const group of SPRITE_KEYMAP) {
		rows.push(group.title);
		for (const b of group.bindings)
			rows.push(`  ${b.keys.padEnd(keyW)}  ${b.label}`);
		rows.push('');
	}
	// Drop the trailing blank.
	rows.pop();
	return rows;
}

// The overlay rows folded to fit `maxRows`: when the single column is too tall,
// the body packs into as many side-by-side columns as it takes to fit the height,
// so the complete map (now including the selection/move group, #399) stays visible
// on a 24-row terminal. Blank group separators are dropped in the packed variant
// to reclaim vertical space; a leading title row keeps the groups legible.
export function helpOverlayRows(maxRows: number): string[] {
	const rows = helpRows();
	if (rows.length <= maxRows) return rows;
	const head = rows.slice(0, 2);
	// Drop the blank group separators in the packed variant to reclaim the rows
	// the extra groups (selection/move, #399) need on a 24-row terminal.
	const body = rows.slice(2).filter((r) => r.trim() !== '');
	const half = Math.ceil(body.length / 2);
	const left = body.slice(0, half);
	const right = body.slice(half);
	const colW = Math.max(...left.map((r) => r.length)) + 4;
	return [
		...head,
		...left.map((r, i) => (r.padEnd(colW) + (right[i] ?? '')).trimEnd()),
	];
}

// The hint line's per-tool fragment — what the tool in hand responds to.
const TOOL_HINTS: Record<SpriteTool, string> = {
	paint: 'space pen · arrows paint · shift-click line · rmb erase',
	erase: 'space pen · arrows erase',
	fill: 'space/lmb fills the region · rmb clears',
	stamp: 'space then a char stamps the cell',
	anchor: 'space places · A pick · c drop override',
	line: 'drag / enter·enter · esc cancel · rmb transparent',
	rect: 'drag / enter·enter · o outline/fill · shift square',
	ellipse: 'drag / enter·enter · o outline/fill · shift circle',
	select: 'drag marquee · y copy · x cut · del clears · shift-arrows frame',
	move: 'drag/arrows floats it · enter drops · esc cancels',
	paste: '9 pastes a float at the source · drag/enter to place',
};

const GLOBAL_HINT = '? help · tab view · u undo · ^s save · q quit';

// The persistent bottom hint line: the active tool's keys, then the globals.
export function hintLine(tool: SpriteTool): string {
	return `${tool}: ${TOOL_HINTS[tool]} ┃ ${GLOBAL_HINT}`;
}
