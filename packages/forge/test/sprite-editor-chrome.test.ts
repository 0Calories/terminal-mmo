// Pure chrome models (spec #387): the 30-column rail's rows and hit-targets,
// the context-sensitive hint line, and the `?` overlay's grouped key map. All
// asserted through observable outputs — row text, returned actions — never the
// row structure for its own sake.
import { describe, expect, test } from 'bun:test';
import { SCENE_PALETTE } from '@mmo/core';
import {
	helpRows,
	hintLine,
	RAIL_TOOLS,
	RAIL_W,
	type RailRow,
	railActionAt,
	railModel,
	SPRITE_KEYMAP,
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
		pose: 'idle',
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

describe('railModel — tools · ink · playback boxes', () => {
	test('carries the three boxes with every tool listed', () => {
		const text = allText(model());
		expect(text).toContain('tools');
		expect(text).toContain('ink');
		expect(text).toContain('playback');
		for (const t of RAIL_TOOLS) expect(text).toContain(t.label);
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

	test('marks the active ink and lists transparent as an ink', () => {
		const rows = model({ ink: TRANSPARENT_INK });
		const active = rows.filter((r) => rowText(r).startsWith('▸'));
		expect(active).toHaveLength(1);
		expect(rowText(active[0])).toContain('transparent');
	});

	test('windows a long ink list around the active ink', () => {
		const rows = model({ ink: colorInk('k'), height: 16 });
		const text = allText(rows);
		// The active ink stays visible even in the shrunken window…
		expect(text).toMatch(/▸.*k/);
		// …and the clipping is announced, never silent.
		expect(text).toContain('more');
		// The playback box survives the squeeze.
		expect(text).toContain('playback');
		expect(rows.length).toBeLessThanOrEqual(16);
	});

	test('shows the pose, fps and frame count, and lights the playing mode', () => {
		const idle = model({ pose: 'walkA', fps: 6, frameCount: 3 });
		expect(allText(idle)).toContain('pose walkA · 6fps · 3f');
		const playing = model({ playMode: 'walk' });
		const walkSpan = playing
			.flatMap((r) => r.spans)
			.find((s) => s.text.includes(', walk'));
		expect(walkSpan?.hot).toBe(true);
		expect(walkSpan?.text).toContain('▶');
	});

	test('ink rows and playback controls are click targets', () => {
		const rows = model();
		let inkHit: ReturnType<typeof railActionAt>;
		let playHit: ReturnType<typeof railActionAt>;
		rows.forEach((row, y) => {
			const text = rowText(row);
			if (text.startsWith('▸')) inkHit = railActionAt(rows, 4, y);
			if (text.includes('. pose'))
				playHit = railActionAt(rows, text.indexOf('. pose'), y);
		});
		expect(inkHit).toEqual({ type: 'ink', ink: colorInk('p') });
		expect(playHit).toEqual({ type: 'play', mode: 'pose' });
	});

	test('a click on dead space returns nothing', () => {
		const rows = model();
		expect(railActionAt(rows, 0, 0)).toBeUndefined();
		expect(railActionAt(rows, 200, 1)).toBeUndefined();
		expect(railActionAt(rows, 1, 999)).toBeUndefined();
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
});
