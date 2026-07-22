import type { RGBAQuad } from '@mmo/core/entities';
import type { Ink, PaletteEntry, SpriteTool } from './state';

export const RAIL_W = 30;

export type RailAction =
	| { readonly type: 'tool'; readonly tool: SpriteTool }
	| { readonly type: 'ink'; readonly ink: Ink }
	| { readonly type: 'play'; readonly mode: 'animation' | 'walk' }
	| { readonly type: 'animationMenu' }
	| { readonly type: 'anchorMenu' }
	| { readonly type: 'canvas' }
	| { readonly type: 'previewToggle' }
	| {
			readonly type: 'variant';
			readonly channel: 'p' | 'a';
			readonly index: number;
	  };

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

export const RAIL_TOOLS: readonly {
	key: string;
	tool: SpriteTool;
	glyph: string;
	label: string;
}[] = [
	{ key: '1', tool: 'select', glyph: '↖', label: 'select' },
	{ key: '2', tool: 'paint', glyph: '✎', label: 'pencil' },
	{ key: '3', tool: 'fill', glyph: '▓', label: 'fill' },
	{ key: '4', tool: 'stamp', glyph: '▣', label: 'stamp' },
	{ key: '5', tool: 'line', glyph: '╱', label: 'line' },
	{ key: '6', tool: 'rect', glyph: '▭', label: 'rect' },
	{ key: '7', tool: 'ellipse', glyph: '○', label: 'ellipse' },
	{ key: '8', tool: 'move', glyph: '✜', label: 'move' },
	{ key: '9', tool: 'paste', glyph: '⧉', label: 'paste' },
];

export const TOOL_GLYPH_FALLBACKS: Readonly<Record<string, string>> = {
	select: '⌖',
	move: '⇄',
	paste: '▤',
};

export interface RailInput {
	readonly tool: SpriteTool;
	readonly ink: Ink;

	readonly entries: readonly PaletteEntry[];
	readonly animation: string;
	readonly fps: number;
	readonly frameCount: number;
	readonly playMode: 'none' | 'animation' | 'walk';

	readonly height: number;

	readonly foldPlayback?: boolean;

	readonly variants?: readonly RailVariant[];

	readonly previewOn?: boolean;
}

export interface RailVariant {
	readonly channel: 'p' | 'a';
	readonly index: number;
	readonly rgba: RGBAQuad;
	readonly active: boolean;
}

function variantRows(variants: readonly RailVariant[]): RailRow[] {
	const rows: RailRow[] = [];
	for (const channel of ['p', 'a'] as const) {
		const options = variants.filter((v) => v.channel === channel);
		if (options.length === 0) continue;
		const spans: RailSpan[] = [{ text: ` ${channel} `, dim: true }];
		for (const v of options) {
			spans.push({
				text: v.active ? '[]' : '  ',
				swatch: v.rgba,
				hot: v.active,
				action: { type: 'variant', channel: v.channel, index: v.index },
			});
		}
		rows.push({ spans });
	}
	return rows;
}

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

export const INKS_PER_ROW = 8;
export const INK_SWATCH_W = 2;

function inkAction(o: InkOption): RailAction {
	return {
		type: 'ink',
		ink:
			o.kind === 'transparent'
				? { kind: 'transparent' }
				: { kind: 'color', key: o.entry.key },
	};
}

function inkGridRows(options: readonly InkOption[], ink: Ink): RailRow[] {
	const rows: RailRow[] = [];
	for (let i = 0; i < options.length; i += INKS_PER_ROW) {
		const spans: RailSpan[] = [{ text: ' ' }];
		for (const o of options.slice(i, i + INKS_PER_ROW)) {
			const active = optionMatches(o, ink);
			spans.push({
				text: active ? '[]' : o.kind === 'transparent' ? '▚▚' : '  ',
				swatch: o.kind === 'transparent' ? 'checker' : o.entry.rgba,
				hot: active,
				action: inkAction(o),
			});
		}
		rows.push({ spans });
	}
	return rows;
}

function activeInkRow(options: readonly InkOption[], ink: Ink): RailRow {
	const active = options.find((o) => optionMatches(o, ink));
	if (!active || active.kind === 'transparent')
		return { spans: [{ text: ' ' }, { text: '▚▚', swatch: 'checker' }] };
	return { spans: [{ text: ' ' }, { text: '  ', swatch: active.entry.rgba }] };
}

export function railModel(input: RailInput): RailRow[] {
	const rows: RailRow[] = [];

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

	rows.push({ spans: [{ text: ' ink', dim: true }], title: true });
	const options = inkOptions(input.entries);
	rows.push(...inkGridRows(options, input.ink));
	rows.push(activeInkRow(options, input.ink));

	rows.push(...variantRows(input.variants ?? []));
	rows.push({ spans: [{ text: '' }] });

	rows.push(
		...(input.foldPlayback ? foldedRailBoxes(input) : railBoxes(input)),
	);
	return rows;
}

function railBoxes(input: RailInput): RailRow[] {
	return [
		{ spans: [{ text: ' edit', dim: true }], title: true },
		{
			spans: [
				{ text: ' ' },
				{ text: '▤ animation', dim: true, action: { type: 'animationMenu' } },
				{ text: ' · ' },
				{ text: '◎ anchor', dim: true, action: { type: 'anchorMenu' } },
			],
		},
		{
			spans: [
				{ text: ' ' },
				{ text: '⤢ canvas', dim: true, action: { type: 'canvas' } },
				{ text: ' · ' },
				{
					text: '◫ preview',
					dim: !input.previewOn,
					hot: input.previewOn,
					action: { type: 'previewToggle' },
				},
			],
		},
	];
}

function foldedRailBoxes(_input: RailInput): RailRow[] {
	return [
		{
			title: true,
			spans: [
				{ text: ' edit', dim: true },
				{ text: '  ' },
				{ text: '▤ animation', dim: true, action: { type: 'animationMenu' } },
				{ text: ' · ' },
				{ text: '◎ anchor', dim: true, action: { type: 'anchorMenu' } },
			],
		},
	];
}

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

export interface KeyBinding {
	readonly keys: string;
	readonly label: string;
}

export interface KeymapGroup {
	readonly title: string;
	readonly bindings: readonly KeyBinding[];
}

export const SPRITE_KEYMAP: readonly KeymapGroup[] = [
	{
		title: 'Global',
		bindings: [
			{ keys: 'tab', label: 'strips ↔ focus view' },
			{ keys: 'enter / esc', label: 'focus frame / back to strips' },
			{ keys: '^s · q', label: 'save · quit' },
			{ keys: 'u / U', label: 'undo / redo (^z / ^r)' },
			{ keys: '+ / -', label: 'zoom ladder (ctrl-wheel too)' },
			{ keys: '?', label: 'this help' },
		],
	},
	{
		title: 'Cursor & paint',
		bindings: [
			{ keys: 'arrows / wasd', label: 'move cursor 1 Pixel' },
			{ keys: 'space', label: 'pen down/up (movement paints)' },
			{ keys: 'shift-arrows', label: 'shift the whole Frame 1 Pixel' },
			{ keys: 'p / 1-9', label: 'pencil · tools in rail order' },
			{ keys: 'y / x / del', label: 'copy / cut / clear selection' },
			{ keys: 'enter / esc', label: 'shape·float commit / cancel' },
		],
	},
	{
		title: 'Mouse — canvas',
		bindings: [
			{ keys: 'click / rmb', label: 'paint ink / transparent (shift: line)' },
			{ keys: 'alt-click', label: 'eyedrop (momentary)' },
			{ keys: 'drag', label: 'shapes · select marquee · move float' },
			{ keys: 'drag ✛ / rmb ✛', label: 'move anchor (◈ = file level) / clear' },
			{ keys: 'click strip', label: 'activate frame (animation nav)' },
			{ keys: 'focus [+] / ◌', label: 'clone last frame · onion ghosts prev' },
			{ keys: '‹ fps ›', label: "strip name row steps the animation's fps" },
			{ keys: 'wheel', label: 'scroll strips (shift: horizontal)' },
			{ keys: 'ctrl-wheel', label: 'zoom · middle-drag pans' },
		],
	},
	{
		title: 'Mouse — rail & preview',
		bindings: [
			{ keys: 'click', label: 'tools · ink swatches · p/a variants' },
			{ keys: 'dbl-click swatch', label: 'define / edit file-local colour' },
			{ keys: 'active rect/○', label: 'click again: outline ↔ filled' },
			{
				keys: 'edit box',
				label: '▤ animation · ◎ anchor · ⤢ canvas · ◫ preview',
			},
			{
				keys: 'anchor menu',
				label: 'click picks (next click places) · ✕ deletes',
			},
			{ keys: '⤢ canvas', label: 'resize + crop every frame (one modal)' },
			{ keys: 'preview pane', label: 'flip · ▶ play' },
		],
	},
];

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

	rows.pop();
	return rows;
}

export function helpOverlayRows(maxRows: number): string[] {
	const rows = helpRows();
	if (rows.length <= maxRows) return rows;
	const head = rows.slice(0, 2);

	const body = rows.slice(2).filter((r) => r.trim() !== '');

	const half = Math.ceil(body.length / 2);
	let split = half;
	let best = Number.POSITIVE_INFINITY;
	body.forEach((r, i) => {
		if (i === 0 || r.startsWith('  ')) return;
		const d = Math.abs(i - half);
		if (d < best) {
			best = d;
			split = i;
		}
	});
	const left = body.slice(0, split);
	const right = body.slice(split);
	const colW = Math.max(...left.map((r) => r.length)) + 4;
	return [
		...head,
		...left.map((r, i) => (r.padEnd(colW) + (right[i] ?? '')).trimEnd()),
	];
}
