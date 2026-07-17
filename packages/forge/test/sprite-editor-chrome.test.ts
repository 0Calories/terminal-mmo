// Pure chrome models (spec #387): the 30-column rail's rows and hit-targets,
// the context-sensitive hint line, and the `?` overlay's grouped key map. All
// asserted through observable outputs — row text, returned actions — never the
// row structure for its own sake.
import { describe, expect, test } from 'bun:test';
import { SCENE_PALETTE } from '@mmo/core/entities';
import {
	helpOverlayRows,
	helpRows,
	hintLine,
	RAIL_TOOLS,
	RAIL_W,
	type RailRow,
	railActionAt,
	railModel,
	SPRITE_KEYMAP,
	TOOL_GLYPH_FALLBACKS,
} from '../src/sprite-editor/chrome';
import {
	colorInk,
	initSpriteEditor,
	paletteEntries,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SPRITE_PREVIEWS } from '../src/sprite-editor/view';

function entriesFor(id = 'r') {
	const state = initSpriteEditor(emptySpriteDoc(id, 'hat'));
	return paletteEntries(state, SCENE_PALETTE, SPRITE_PREVIEWS);
}

function model(overrides: Partial<Parameters<typeof railModel>[0]> = {}) {
	return railModel({
		tool: 'paint',
		ink: colorInk('p'),
		entries: entriesFor(),
		animation: 'idle',
		fps: 8,
		frameCount: 1,
		playMode: 'none',
		onionDepth: 0,
		height: 22,
		...overrides,
	});
}

function rowText(row: RailRow): string {
	return row.spans.map((s) => s.text).join('');
}

function allText(rows: readonly RailRow[]): string {
	return rows.map(rowText).join('\n');
}

describe('railModel — tools · ink · playback boxes', () => {
	test('carries the three boxes with every tool listed', () => {
		const text = allText(model());
		expect(text).toContain('tools');
		expect(text).toContain('ink');
		expect(text).toContain('playback');
		for (const t of RAIL_TOOLS) expect(text).toContain(t.label);
	});

	test('the ink title no longer advertises the retired i eyedrop key', () => {
		expect(allText(model())).not.toContain('i eye');
	});

	test('variant rows sit in the rail: per-channel swatches, active bracketed, clicks select', () => {
		const rows = model({
			variants: [
				{ channel: 'p', index: 0, rgba: [1, 2, 3, 255], active: false },
				{ channel: 'p', index: 1, rgba: [4, 5, 6, 255], active: true },
				{ channel: 'a', index: 0, rgba: [7, 8, 9, 255], active: true },
			],
		});
		// One labeled row per channel, and every row still fits the rail.
		const texts = rows.map(rowText);
		expect(texts.some((t) => t.startsWith(' p '))).toBe(true);
		expect(texts.some((t) => t.startsWith(' a '))).toBe(true);
		for (const row of rows)
			expect(rowText(row).length).toBeLessThanOrEqual(RAIL_W - 1);
		// The active swatch is bracket-marked; clicking a swatch selects it.
		const pRowY = rows.findIndex((r) => rowText(r).startsWith(' p '));
		const pRow = rows[pRowY];
		const active = pRow.spans.find((s) => s.text === '[]');
		expect(active?.action).toEqual({ type: 'variant', channel: 'p', index: 1 });
		let x = 0;
		let hit: unknown = null;
		for (const s of pRow.spans) {
			if (s.action?.type === 'variant' && s.action.index === 0)
				hit = railActionAt(rows, x, pRowY);
			x += s.text.length;
		}
		expect(hit).toEqual({ type: 'variant', channel: 'p', index: 0 });
	});

	test('no variants → no variant rows', () => {
		const texts = model().map(rowText);
		expect(texts.some((t) => t.startsWith(' p ') || t.startsWith(' a '))).toBe(
			false,
		);
	});

	test('every row fits inside the rail width', () => {
		for (const row of model()) {
			expect(rowText(row).length).toBeLessThanOrEqual(RAIL_W - 1);
		}
	});

	test('marks the active tool hot and clicking a tool returns its action', () => {
		const rows = model({ tool: 'stamp' });
		const stampSpan = rows
			.flatMap((r) => r.spans)
			.find((s) => s.text.includes('stamp'));
		expect(stampSpan?.hot).toBe(true);
		// Find the stamp span's rendered position and hit it.
		let hit: ReturnType<typeof railActionAt>;
		rows.forEach((row, y) => {
			let x0 = 0;
			for (const s of row.spans) {
				if (s.text.includes('stamp'))
					hit = railActionAt(rows, x0 + s.text.indexOf('stamp'), y);
				x0 += s.text.length;
			}
		});
		expect(hit).toEqual({ type: 'tool', tool: 'stamp' });
	});

	test('the ink grid lists every entry as an unlabeled swatch, transparent last', () => {
		const entries = entriesFor();
		const rows = model({ entries });
		// Grid rows only (exclude the active-colour square section): rows whose
		// swatch spans carry ink actions.
		const gridSpans = rows
			.flatMap((r) => r.spans)
			.filter((s) => s.swatch !== undefined && s.action?.type === 'ink');
		// Every palette entry plus the transparent pseudo-ink, in entry order.
		expect(gridSpans.length).toBe(entries.length + 1);
		const last = gridSpans[gridSpans.length - 1];
		expect(last.swatch).toBe('checker');
		expect(last.action).toEqual({ type: 'ink', ink: { kind: 'transparent' } });
		// Unlabeled: each swatch is exactly 2 columns, no key/name text rides it.
		for (const s of gridSpans) expect(s.text.length).toBe(2);
		// 8 swatches per row.
		for (const row of rows) {
			const n = row.spans.filter(
				(s) => s.swatch !== undefined && s.action?.type === 'ink',
			).length;
			expect(n).toBeLessThanOrEqual(8);
		}
		// The whole list is always visible — no windowing, no 'more' markers.
		expect(allText(rows)).not.toContain('more');
	});

	test('marks the active swatch and renders the active colour as a plain square', () => {
		const entries = entriesFor();
		const rows = model({ ink: colorInk('g'), entries });
		const active = rows
			.flatMap((r) => r.spans)
			.filter((s) => s.action?.type === 'ink' && s.hot);
		expect(active).toHaveLength(1);
		expect(active[0].action).toEqual({ type: 'ink', ink: colorInk('g') });
		// The active-colour section: a bare swatch with NO action and NO text
		// label (no key, no name, no hex).
		const squares = rows
			.flatMap((r) => r.spans)
			.filter((s) => s.swatch !== undefined && s.action === undefined);
		expect(squares).toHaveLength(1);
		const g = entries.find((e) => e.key === 'g');
		expect(squares[0].swatch).toEqual(g?.rgba);
		expect(squares[0].text.trim()).toBe('');
	});

	test('a transparent active ink marks the checker swatch and squares to checker', () => {
		const rows = model({ ink: TRANSPARENT_INK });
		const active = rows
			.flatMap((r) => r.spans)
			.filter((s) => s.action?.type === 'ink' && s.hot);
		expect(active).toHaveLength(1);
		expect(active[0].swatch).toBe('checker');
		const square = rows
			.flatMap((r) => r.spans)
			.find((s) => s.swatch !== undefined && s.action === undefined);
		expect(square?.swatch).toBe('checker');
	});

	test('shows the animation, fps and frame count, and lights the playing mode', () => {
		const idle = model({ animation: 'walkA', fps: 6, frameCount: 3 });
		expect(allText(idle)).toContain('animation walkA · 6fps · 3f');
		const playing = model({ playMode: 'walk' });
		const walkSpan = playing
			.flatMap((r) => r.spans)
			.find((s) => s.text.includes(', walk'));
		expect(walkSpan?.hot).toBe(true);
		expect(walkSpan?.text).toContain('▶');
	});

	test('surfaces the onion-skin depth in the playback box', () => {
		const off = model();
		const offSpan = off
			.flatMap((r) => r.spans)
			.find((s) => s.text.startsWith('O '));
		expect(offSpan?.text).toBe('O 0');
		expect(offSpan?.hot).toBeFalsy();
		const on = model({ onionDepth: 2 });
		const onSpan = on
			.flatMap((r) => r.spans)
			.find((s) => s.text.startsWith('O '));
		expect(onSpan?.text).toBe('O 2');
		expect(onSpan?.hot).toBe(true);
	});

	test('ink swatches and playback controls are click targets', () => {
		const rows = model();
		// The first grid swatch sits one column in on the first grid row; walk the
		// spans to its rendered x and hit it.
		let inkHit: ReturnType<typeof railActionAt>;
		let playHit: ReturnType<typeof railActionAt>;
		rows.forEach((row, y) => {
			let x0 = 0;
			for (const s of row.spans) {
				if (inkHit === undefined && s.action?.type === 'ink')
					inkHit = railActionAt(rows, x0, y);
				x0 += s.text.length;
			}
			const text = rowText(row);
			if (text.includes('. animation'))
				playHit = railActionAt(rows, text.indexOf('. animation'), y);
		});
		// entriesFor() lists the palette in paletteEntries order; the first grid
		// swatch is its first entry.
		expect(inkHit).toEqual({ type: 'ink', ink: colorInk(entriesFor()[0].key) });
		expect(playHit).toEqual({ type: 'play', mode: 'animation' });
	});

	test('a click on dead space returns nothing', () => {
		const rows = model();
		expect(railActionAt(rows, 0, 0)).toBeUndefined();
		expect(railActionAt(rows, 200, 1)).toBeUndefined();
		expect(railActionAt(rows, 1, 999)).toBeUndefined();
	});
});

describe('rail tool icons', () => {
	test('each tool row renders number · glyph · label', () => {
		const text = allText(model());
		for (const t of RAIL_TOOLS)
			expect(text).toContain(`${t.key} ${t.glyph} ${t.label}`);
	});

	test('the active tool row leads with the ▸ marker before its number', () => {
		const rows = model({ tool: 'paint' });
		const pencil = rows
			.flatMap((r) => r.spans)
			.find((s) => s.text.includes('pencil'));
		expect(pencil?.text).toContain('▸1 ✎ pencil');
	});

	test('every glyph and fallback is one column by the renderer/hit-test width rules', () => {
		// The rail's hit-testing (railActionAt) walks span.text.length and the
		// buffer draws one cell per UTF-16 unit, so a rail glyph must be exactly
		// one code unit AND one terminal column — anything else desyncs every
		// mouse column to its right (see the cursor-ring width note in tui.ts).
		const glyphs = [
			...RAIL_TOOLS.map((t) => t.glyph),
			...Object.values(TOOL_GLYPH_FALLBACKS),
		];
		expect(glyphs.length).toBeGreaterThan(0);
		for (const g of glyphs) {
			expect([...g].length).toBe(1); // one code point
			expect(g.length).toBe(1); // one UTF-16 unit (hit-testing measure)
			expect(Bun.stringWidth(g)).toBe(1); // one terminal column
		}
	});
});

describe('help surface — hint line + ? overlay', () => {
	test('the hint line is context-sensitive: tool keys plus the globals', () => {
		const pencil = hintLine('paint');
		expect(pencil).toContain('pen');
		expect(pencil).toContain('? help');
		expect(pencil).toContain('q quit');
		const stamp = hintLine('stamp');
		expect(stamp).toContain('stamp');
		expect(stamp).not.toContain('rmb erase');
		expect(stamp).toContain('? help');
	});

	test('the overlay rows carry every group and every binding', () => {
		const rows = helpRows();
		const text = rows.join('\n');
		for (const group of SPRITE_KEYMAP) {
			expect(text).toContain(group.title);
			for (const b of group.bindings) expect(text).toContain(b.label);
		}
	});

	test('the overlay documents the locked navigation gestures', () => {
		const text = helpRows().join('\n');
		expect(text).toContain('wheel');
		expect(text).toContain('shift-wheel');
		expect(text).toContain('ctrl-wheel');
		expect(text).toContain('middle-drag');
		expect(text).toContain('click-through');
	});

	test('the keymap tracks the retired and rebound keys', () => {
		const text = helpRows().join('\n');
		// Retired: the c quick-pick and the ;/' ink nudge (ink is mouse-only).
		expect(text).not.toContain('quick-pick');
		expect(text).not.toContain('nudge');
		// Crop moved to plain c.
		const crop = SPRITE_KEYMAP.flatMap((g) => g.bindings).find((b) =>
			b.label.includes('crop'),
		);
		expect(crop?.keys).toBe('c');
		// Focus navigation is documented.
		expect(text).toContain('focus');
		const nav = SPRITE_KEYMAP.flatMap((g) => g.bindings).find((b) =>
			b.label.includes('focus frame'),
		);
		expect(nav?.keys).toContain('enter');
		// Mouse-only ink selection is documented.
		expect(text).toContain('swatch');
	});

	test('the anchor tool hint no longer claims c drops an override', () => {
		expect(hintLine('anchor')).not.toContain('c drop');
	});

	test('the ? overlay fits a 120×24 terminal', () => {
		// The modal budget at H=24 is helpOverlayRows(22) (see tui renderHelp).
		const rows = helpOverlayRows(22);
		expect(rows.length).toBeLessThanOrEqual(22);
		for (const r of rows) expect(r.length).toBeLessThanOrEqual(120);
	});
});
