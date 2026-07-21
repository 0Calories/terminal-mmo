// Pure chrome models (spec #387): the 30-column rail's rows and hit-targets,
// the context-sensitive hint line, and the `?` overlay's grouped key map. All
// asserted through observable outputs — row text, returned actions — never the
// row structure for its own sake.
import { describe, expect, test } from 'bun:test';
import { SCENE_PALETTE } from '@mmo/core/entities';
import {
	helpOverlayRows,
	helpRows,
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

describe('railModel — tools · ink · edit box', () => {
	test('carries the boxes with every tool listed', () => {
		const text = allText(model());
		expect(text).toContain('tools');
		expect(text).toContain('ink');
		// The three control boxes fused into a single `edit` box (round 3).
		expect(text).toContain('edit');
		expect(text).not.toContain('playback');
		// Frame creation, onion, and the size boxes left the rail (round 3).
		expect(text).not.toContain('✚ frame');
		expect(text).not.toContain('◌ onion');
		expect(text).not.toContain('⤢ resize');
		expect(text).not.toContain('✂ crop');
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

	test('the redundant animation · fps · frame-count info line is dropped', () => {
		// The strip label/stepper and the status row carry this now (post-#351).
		const text = allText(model({ animation: 'walkA', fps: 6, frameCount: 3 }));
		expect(text).not.toContain('walkA · 6fps · 3f');
		expect(text).not.toContain('6fps');
	});

	test('play and walk have left the rail (they live on the preview pane + menu)', () => {
		const spans = model({ playMode: 'walk' }).flatMap((r) => r.spans);
		expect(spans.some((s) => s.action?.type === 'play')).toBe(false);
		expect(allText(model())).not.toContain('walk');
	});

	test('onion has left the rail (round 3: it lives on the focus tab row)', () => {
		const spans = model().flatMap((r) => r.spans);
		expect(spans.some((s) => s.text.startsWith('◌ onion'))).toBe(false);
	});

	test('every edit-box button carries its width-1 glyph and self-labels', () => {
		const rows = model({ previewOn: false });
		const spans = rows.flatMap((r) => r.spans);
		const byAction = (type: string) =>
			spans.find((s) => s.action?.type === type);
		expect(byAction('animationMenu')?.text).toBe('▤ animation');
		expect(byAction('anchorMenu')?.text).toBe('◎ anchor');
		// resize + crop fused into one canvas-size button (round 3).
		expect(byAction('canvas')?.text).toBe('⤢ canvas');
		expect(byAction('previewToggle')?.text).toBe('◫ preview');
		expect(byAction('previewToggle')?.hot).toBeFalsy();
		// The buttons that left the rail (round 3).
		expect(byAction('mirror')).toBeUndefined();
		expect(byAction('addFrame')).toBeUndefined();
		expect(byAction('resize')).toBeUndefined();
		expect(byAction('crop')).toBeUndefined();
		// Each leading glyph is exactly one terminal column so hit-testing stays
		// aligned.
		for (const label of ['▤ animation', '◎ anchor', '⤢ canvas', '◫ preview'])
			expect(Bun.stringWidth([...label][0])).toBe(1);
	});

	test('ink swatches and control buttons are click targets', () => {
		const rows = model();
		// The first grid swatch sits one column in on the first grid row; walk the
		// spans to its rendered x and hit it.
		let inkHit: ReturnType<typeof railActionAt>;
		let canvasHit: ReturnType<typeof railActionAt>;
		rows.forEach((row, y) => {
			let x0 = 0;
			for (const s of row.spans) {
				if (inkHit === undefined && s.action?.type === 'ink')
					inkHit = railActionAt(rows, x0, y);
				if (canvasHit === undefined && s.action?.type === 'canvas')
					canvasHit = railActionAt(rows, x0, y);
				x0 += s.text.length;
			}
		});
		// entriesFor() lists the palette in paletteEntries order; the first grid
		// swatch is its first entry.
		expect(inkHit).toEqual({ type: 'ink', ink: colorInk(entriesFor()[0].key) });
		expect(canvasHit).toEqual({ type: 'canvas' });
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
		// Pencil sits at number key 2 (select leads the rail at 1).
		expect(pencil?.text).toContain('▸2 ✎ pencil');
	});

	test('select leads the rail at number key 1; pencil follows at 2', () => {
		expect(RAIL_TOOLS[0]).toMatchObject({ key: '1', tool: 'select' });
		expect(RAIL_TOOLS[1]).toMatchObject({ key: '2', tool: 'paint' });
		// Every number-row key ascends with array position, 1-based.
		RAIL_TOOLS.forEach((t, i) => {
			expect(t.key).toBe(String(i + 1));
		});
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

describe('help surface — ? overlay (the hint line is retired, QA round 3)', () => {
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
		expect(text).toContain('ctrl-wheel');
		expect(text).toContain('middle-drag');
	});

	test('the keymap is the culled mouse-primary set (ADR 0035)', () => {
		const allKeys = SPRITE_KEYMAP.flatMap((g) => g.bindings)
			.map((b) => b.keys)
			.join(' ');
		// The keyboard survivors.
		for (const kept of ['wasd', 'space', 'u / U', '^s', 'q', '?', 'p', 'tab'])
			expect(allKeys).toContain(kept);
		// The dead keys never appear as bindings.
		for (const dead of [
			'[ ]',
			'{ }',
			'hjkl',
			'P /',
			'A /',
			'R',
			'O',
			'. /',
			', /',
		])
			expect(allKeys).not.toContain(dead);
		// Every mouse affordance the cull leans on is documented.
		const text = helpRows().join('\n');
		expect(text).toContain('eyedrop');
		expect(text).toContain('dbl-click swatch');
		expect(text).toContain('outline ↔ filled');
		expect(text).toContain('fps');
		// The canvas-split mirror feature is deleted (round 3).
		expect(text).not.toContain('mirror');
		expect(text).toContain('resize');
		expect(text).toContain('crop');
		expect(text).toContain('flip');
	});

	test('the ? overlay fits a 120×24 terminal', () => {
		// The modal budget at H=24 is helpOverlayRows(22) (see tui renderHelp).
		const rows = helpOverlayRows(22);
		expect(rows.length).toBeLessThanOrEqual(22);
		for (const r of rows) expect(r.length).toBeLessThanOrEqual(120);
	});
});
