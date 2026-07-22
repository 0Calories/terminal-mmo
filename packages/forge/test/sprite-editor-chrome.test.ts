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

		expect(text).toContain('edit');
		expect(text).not.toContain('playback');

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

		const texts = rows.map(rowText);
		expect(texts.some((t) => t.startsWith(' p '))).toBe(true);
		expect(texts.some((t) => t.startsWith(' a '))).toBe(true);
		for (const row of rows)
			expect(rowText(row).length).toBeLessThanOrEqual(RAIL_W - 1);

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

		const gridSpans = rows
			.flatMap((r) => r.spans)
			.filter((s) => s.swatch !== undefined && s.action?.type === 'ink');

		expect(gridSpans.length).toBe(entries.length + 1);
		const last = gridSpans[gridSpans.length - 1];
		expect(last.swatch).toBe('checker');
		expect(last.action).toEqual({ type: 'ink', ink: { kind: 'transparent' } });

		for (const s of gridSpans) expect(s.text.length).toBe(2);

		for (const row of rows) {
			const n = row.spans.filter(
				(s) => s.swatch !== undefined && s.action?.type === 'ink',
			).length;
			expect(n).toBeLessThanOrEqual(8);
		}

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

		expect(byAction('canvas')?.text).toBe('⤢ canvas');
		expect(byAction('previewToggle')?.text).toBe('◫ preview');
		expect(byAction('previewToggle')?.hot).toBeFalsy();

		expect(byAction('mirror')).toBeUndefined();
		expect(byAction('addFrame')).toBeUndefined();
		expect(byAction('resize')).toBeUndefined();
		expect(byAction('crop')).toBeUndefined();

		for (const label of ['▤ animation', '◎ anchor', '⤢ canvas', '◫ preview'])
			expect(Bun.stringWidth([...label][0])).toBe(1);
	});

	test('ink swatches and control buttons are click targets', () => {
		const rows = model();

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

		expect(pencil?.text).toContain('▸2 ✎ pencil');
	});

	test('select leads the rail at number key 1; pencil follows at 2', () => {
		expect(RAIL_TOOLS[0]).toMatchObject({ key: '1', tool: 'select' });
		expect(RAIL_TOOLS[1]).toMatchObject({ key: '2', tool: 'paint' });

		RAIL_TOOLS.forEach((t, i) => {
			expect(t.key).toBe(String(i + 1));
		});
	});

	test('every glyph and fallback is one column by the renderer/hit-test width rules', () => {
		const glyphs = [
			...RAIL_TOOLS.map((t) => t.glyph),
			...Object.values(TOOL_GLYPH_FALLBACKS),
		];
		expect(glyphs.length).toBeGreaterThan(0);
		for (const g of glyphs) {
			expect([...g].length).toBe(1);
			expect(g.length).toBe(1);
			expect(Bun.stringWidth(g)).toBe(1);
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

		for (const kept of ['wasd', 'space', 'u / U', '^s', 'q', '?', 'p', 'tab'])
			expect(allKeys).toContain(kept);

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

		const text = helpRows().join('\n');
		expect(text).toContain('eyedrop');
		expect(text).toContain('dbl-click swatch');
		expect(text).toContain('outline ↔ filled');
		expect(text).toContain('fps');

		expect(text).not.toContain('mirror');
		expect(text).toContain('resize');
		expect(text).toContain('crop');
		expect(text).toContain('flip');
	});

	test('the ? overlay fits a 120×24 terminal', () => {
		const rows = helpOverlayRows(22);
		expect(rows.length).toBeLessThanOrEqual(22);
		for (const r of rows) expect(r.length).toBeLessThanOrEqual(120);
	});
});
