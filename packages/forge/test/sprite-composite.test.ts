import { expect, test } from 'bun:test';
import {
	buildSceneStyle,
	type CellBuffer,
	formFrame,
	mapDocFrames,
	type RenderStyle,
	type SpriteDoc,
} from '@mmo/render';
import {
	buildComposite,
	renderComposite,
	styleWithLocalColors,
} from '../src/sprite-editor/composite';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	blended?: boolean;
}

class FakeBuffer implements CellBuffer<string> {
	readonly cells = new Map<string, Cell>();
	constructor(
		readonly width: number,
		readonly height: number,
	) {}
	clear(): void {
		this.cells.clear();
	}
	setCell(x: number, y: number, ch: string, fg: string, bg: string): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg });
	}
	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: string,
		bg: string,
	): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg, blended: true });
	}
}

const STYLE: RenderStyle<string> = buildSceneStyle(
	(r, g, b, a) => `${r},${g},${b},${a}`,
);
const VIEW = { facing: 1 as const, stance: 'idle', elapsedS: 0 };
const DIMS = { width: 24, height: 16 };

function frame(rows: string[], anchors = {}) {
	return {
		rows,
		colors: rows.map((row) => 'w'.repeat(row.length)),
		bg: rows.map((row) => ' '.repeat(row.length)),
		anchors,
	};
}

function doc(
	id: string,
	animations: SpriteDoc['animations'],
	anchors: SpriteDoc['anchors'] = {},
): SpriteDoc {
	return { id, key: 'w', baseline: 0, anchors, animations, colors: {} };
}

function plainDoc(rows: string[]): SpriteDoc {
	return doc('plain', [{ name: 'idle', frames: [frame(rows)] }]);
}

function formDoc(): SpriteDoc {
	return doc(
		'form',
		[
			{ name: 'idle', frames: [frame(['B'])] },
			{ name: 'walk', frames: [frame(['B']), frame(['b'])] },
		],
		{ grip: { x: 0, y: 0 }, head: { x: 0, y: 0 } },
	);
}

function weaponDoc(): SpriteDoc {
	return doc(
		'weapon',
		[
			{ name: 'idle', frames: [frame(['R'])] },
			{
				name: 'swing',
				frames: [frame(['1']), frame(['2']), frame(['3'])],
			},
		],
		{ grip: { x: 0, y: 0 } },
	);
}

function glyphCells(buf: FakeBuffer): [string, Cell][] {
	return [...buf.cells].filter(([, cell]) => cell.ch !== ' ');
}

test('buildComposite produces role-appropriate renderer overrides', () => {
	const hat = buildComposite(plainDoc(['H']), 'hat', VIEW, DIMS);
	const form = buildComposite(formDoc(), 'form', VIEW, DIMS);
	const weapon = buildComposite(weaponDoc(), 'weapon', VIEW, DIMS);
	const monster = buildComposite(plainDoc(['M']), 'monster', VIEW, DIMS);

	expect(hat?.overrides.hat).toBeDefined();
	expect(form?.overrides.body).toBeDefined();
	expect(weapon?.overrides.weapon).toBeDefined();
	expect(monster?.overrides.base).toBeDefined();
});

test('renderComposite centers the non-space composition bounds', () => {
	const buf = new FakeBuffer(12, 8);
	expect(
		renderComposite(buf, plainDoc(['XX', 'X ']), 'monster', STYLE, VIEW),
	).toBe(true);
	const points = glyphCells(buf).map(([key]) => key.split(',').map(Number));
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	const left = Math.min(...xs);
	const right = buf.width - 1 - Math.max(...xs);
	const top = Math.min(...ys);
	const bottom = buf.height - 1 - Math.max(...ys);
	expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
	expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
});

test('editing a document changes the rendered work-in-progress source', () => {
	const original = plainDoc(['X']);
	const edited = mapDocFrames(original, (source) => ({
		...source,
		rows: source.rows.map((row) => row.replaceAll('X', 'Y')),
	}));
	const before = new FakeBuffer(DIMS.width, DIMS.height);
	const after = new FakeBuffer(DIMS.width, DIMS.height);
	renderComposite(before, original, 'monster', STYLE, VIEW);
	renderComposite(after, edited, 'monster', STYLE, VIEW);
	expect(glyphCells(before).map(([, cell]) => cell.ch)).toEqual(['X']);
	expect(glyphCells(after).map(([, cell]) => cell.ch)).toEqual(['Y']);
});

test('styleWithLocalColors merges local keys without mutating the base style', () => {
	expect(
		styleWithLocalColors(STYLE, {}, (r, g, b, a) => `${r},${g},${b},${a}`),
	).toBe(STYLE);
	const merged = styleWithLocalColors(
		STYLE,
		{ z: [11, 22, 33, 255], w: [1, 2, 3, 255] },
		(r, g, b, a) => `${r},${g},${b},${a}`,
	);
	expect(merged.palette.z).toBe('11,22,33,255');
	expect(merged.palette.w).toBe('1,2,3,255');
	expect(STYLE.palette.z).toBeUndefined();
});

test('local colors change color resolution without changing composition', () => {
	const source: SpriteDoc = {
		...plainDoc(['XX']),
		colors: { z: [11, 22, 33, 255] },
		animations: [
			{
				name: 'idle',
				frames: [{ rows: ['XX'], colors: ['zz'], bg: ['  '], anchors: {} }],
			},
		],
	};
	const fallback = new FakeBuffer(DIMS.width, DIMS.height);
	const faithful = new FakeBuffer(DIMS.width, DIMS.height);
	renderComposite(fallback, source, 'monster', STYLE, VIEW);
	const merged = styleWithLocalColors(
		STYLE,
		source.colors,
		(r, g, b, a) => `${r},${g},${b},${a}`,
	);
	renderComposite(faithful, source, 'monster', merged, VIEW);
	expect(glyphCells(faithful).map(([position]) => position)).toEqual(
		glyphCells(fallback).map(([position]) => position),
	);
	expect(glyphCells(fallback)[0]?.[1].fg).toBe(STYLE.paletteDefault);
	expect(glyphCells(faithful)[0]?.[1].fg).toBe('11,22,33,255');
});

test('facing mirrors both glyph orientation and relative placement', () => {
	const source = plainDoc(['/A']);
	const right = new FakeBuffer(DIMS.width, DIMS.height);
	const left = new FakeBuffer(DIMS.width, DIMS.height);
	renderComposite(right, source, 'monster', STYLE, VIEW);
	renderComposite(left, source, 'monster', STYLE, { ...VIEW, facing: -1 });
	const xOf = (buf: FakeBuffer, glyph: string) =>
		Number(
			glyphCells(buf)
				.find(([, cell]) => cell.ch === glyph)?.[0]
				.split(',')[0],
		);
	expect(xOf(right, '/')).toBeLessThan(xOf(right, 'A'));
	expect(xOf(left, '\\')).toBeGreaterThan(xOf(left, 'A'));
});

test('frame-level anchors are preserved in the selected form frame', () => {
	const source = doc(
		'form',
		[
			{ name: 'idle', frames: [frame(['B'])] },
			{
				name: 'emote:sit',
				frames: [frame(['B'], { head: { x: 0, y: 2 } })],
			},
		],
		{ grip: { x: 0, y: 0 }, head: { x: 0, y: 0 } },
	);
	const built = buildComposite(
		source,
		'form',
		{ ...VIEW, stance: 'emote:sit' },
		DIMS,
	);
	const body = built?.overrides.body;
	if (!body) throw new Error('expected a form override');
	expect(formFrame(body, 'idle').anchors.head).toEqual({ x: 0, y: 2 });
});

test('the view hue is propagated to the composite entity', () => {
	const source = plainDoc(['H']);
	expect(
		buildComposite(source, 'hat', { ...VIEW, hue: 3 }, DIMS)?.entity.cosmetics
			?.hue,
	).toBe(3);
	expect(buildComposite(source, 'hat', VIEW, DIMS)?.entity.cosmetics?.hue).toBe(
		0,
	);
});
