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
// line, rect, ellipse, select, move, paste; erase is demoted to the right button,
// off the rail. Later slices insert line/rect/ellipse/select/move/paste).
export const RAIL_TOOLS: readonly {
	key: string;
	tool: SpriteTool;
	label: string;
}[] = [
	{ key: '1', tool: 'paint', label: 'pencil' },
	{ key: '2', tool: 'fill', label: 'fill' },
	{ key: '3', tool: 'stamp', label: 'stamp' },
	{ key: '4', tool: 'anchor', label: 'anchor' },
];

export interface RailInput {
	readonly tool: SpriteTool;
	readonly ink: Ink;
	// Everything paintable, from paletteEntries() — locals, palette, dynamics.
	readonly entries: readonly PaletteEntry[];
	readonly pose: string;
	readonly fps: number;
	readonly frameCount: number;
	readonly playMode: 'none' | 'pose' | 'walk';
	// Rows available for the rail (the canvas region's height).
	readonly height: number;
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
				text: `${active ? '▸' : ' '}${t.key} ${t.label}`.padEnd(12),
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
			{ text: '  f pick · t clear', dim: true, action: { type: 'pickInk' } },
		],
		title: true,
	});
	const options = inkOptions(input.entries);
	const activeIdx = Math.max(
		0,
		options.findIndex((o) => optionMatches(o, input.ink)),
	);
	// The playback box is built first so the ink window's row budget is derived
	// from its real size, never a hand-counted constant.
	const playback = playbackBox(input);
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
			{ keys: '1-4 / p e s a', label: 'pencil · erase · stamp · anchor' },
		],
	},
	{
		title: 'Global',
		bindings: [
			{ keys: '?', label: 'this help' },
			{ keys: 'tab', label: 'strips ↔ focus view' },
			{ keys: '^s / w', label: 'save' },
			{ keys: 'u / ^z', label: 'undo' },
			{ keys: 'U / ^r', label: 'redo' },
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
			{ keys: 't', label: 'set ink transparent' },
			{ keys: 'f', label: 'ink picker' },
			{ keys: 'c', label: 'clear cell (anchor: drop override)' },
			{ keys: 'esc', label: 'cancel overlay / stamp' },
		],
	},
	{
		title: 'Frames & poses',
		bindings: [
			{ keys: '[ / ]', label: 'previous / next frame' },
			{ keys: '{ / }', label: 'previous / next pose' },
			{ keys: 'n', label: 'add frame to current pose' },
			{ keys: 'P / A', label: 'pose menu / anchor menu' },
			{ keys: '. / ,', label: 'play pose / walk preview' },
		],
	},
	{
		title: 'Navigation',
		bindings: [
			{ keys: 'wheel', label: 'scroll strips' },
			{ keys: 'shift-wheel', label: 'scroll horizontally' },
			{ keys: 'ctrl-wheel', label: 'zoom' },
			{ keys: 'middle-drag', label: 'pan' },
			{ keys: 'click a frame', label: 'activate it (click-through)' },
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

// The overlay rows folded to fit `maxRows`: when the single column is too
// tall, the body splits into two side-by-side columns so the complete map
// stays visible on a 24-row terminal.
export function helpOverlayRows(maxRows: number): string[] {
	const rows = helpRows();
	if (rows.length <= maxRows) return rows;
	const head = rows.slice(0, 2);
	const body = rows.slice(2);
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
	paint: 'space pen · arrows paint · rmb erase',
	erase: 'space pen · arrows erase',
	fill: 'space/lmb fills the region · rmb clears',
	stamp: 'space then a char stamps the cell',
	anchor: 'space places · A pick · c drop override',
};

const GLOBAL_HINT = '? help · tab view · u undo · ^s save · q quit';

// The persistent bottom hint line: the active tool's keys, then the globals.
export function hintLine(tool: SpriteTool): string {
	return `${tool}: ${TOOL_HINTS[tool]} ┃ ${GLOBAL_HINT}`;
}
