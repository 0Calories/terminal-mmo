import { expect, test } from 'bun:test';
import { mapDocFrames, type SpriteDoc } from '@mmo/render';
import type { Cell, RGBA } from '@mmo/render/compositor';
import {
	baseCompositeStyle,
	buildComposite,
	renderComposite,
	styleWithLocalColors,
} from '../src/sprite-editor/composite';

const STYLE = baseCompositeStyle();
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
	colors: SpriteDoc['colors'] = {},
): SpriteDoc {
	return { id, key: 'w', baseline: 0, anchors, animations, colors };
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
			{ name: 'swing', frames: [frame(['1']), frame(['2']), frame(['3'])] },
		],
		{ grip: { x: 0, y: 0 } },
	);
}

/** Non-space cells of a composed surface as [x, y, cell] tuples. */
function inkedCells(surface: Cell[][]): [number, number, Cell][] {
	const out: [number, number, Cell][] = [];
	for (let y = 0; y < surface.length; y++)
		for (let x = 0; x < surface[y].length; x++)
			if (surface[y][x].char !== ' ') out.push([x, y, surface[y][x]]);
	return out;
}

function charsOf(surface: Cell[][]): string[] {
	return inkedCells(surface).map(([, , cell]) => cell.char);
}

function rgbaEq(a: RGBA, b: readonly number[]): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

test('buildComposite lays out role-appropriate layers', () => {
	const hat = buildComposite(plainDoc(['H']), 'hat', VIEW, DIMS);
	const form = buildComposite(formDoc(), 'form', VIEW, DIMS);
	const weapon = buildComposite(weaponDoc(), 'weapon', VIEW, DIMS);
	const monster = buildComposite(plainDoc(['M']), 'monster', VIEW, DIMS);

	// A hat/weapon composite hangs the edited layer on a shipped body, so it has
	// more than one layer; a monster is the whole actor in a single layer.
	expect((hat?.layers.length ?? 0) >= 2).toBe(true);
	expect((form?.layers.length ?? 0) >= 1).toBe(true);
	expect((weapon?.layers.length ?? 0) >= 2).toBe(true);
	expect(monster?.layers.length).toBe(1);
});

test('renderComposite centers the non-space composition bounds', () => {
	const surface = renderComposite(
		plainDoc(['XX', 'X ']),
		'monster',
		STYLE,
		VIEW,
		{ width: 12, height: 8 },
	);
	expect(surface).not.toBeNull();
	if (!surface) return;
	const points = inkedCells(surface);
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	const left = Math.min(...xs);
	const right = 12 - 1 - Math.max(...xs);
	const top = Math.min(...ys);
	const bottom = 8 - 1 - Math.max(...ys);
	expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
	expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
});

test('editing a document changes the composed glyphs', () => {
	const original = plainDoc(['X']);
	const edited = mapDocFrames(original, (source) => ({
		...source,
		rows: source.rows.map((row) => row.replaceAll('X', 'Y')),
	}));
	const before = renderComposite(original, 'monster', STYLE, VIEW, DIMS);
	const after = renderComposite(edited, 'monster', STYLE, VIEW, DIMS);
	expect(charsOf(before ?? [])).toEqual(['X']);
	expect(charsOf(after ?? [])).toEqual(['Y']);
});

test('styleWithLocalColors merges local keys without mutating the base', () => {
	expect(styleWithLocalColors(STYLE, {})).toBe(STYLE);
	const merged = styleWithLocalColors(STYLE, {
		z: [11, 22, 33, 255],
		w: [1, 2, 3, 255],
	});
	expect(rgbaEq(merged.palette.z, [11, 22, 33, 255])).toBe(true);
	expect(rgbaEq(merged.palette.w, [1, 2, 3, 255])).toBe(true);
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
	// The doc's own colors compile into the sprite palette, so both renders place
	// the same glyphs; the local color drives the resolved foreground.
	const surface = renderComposite(source, 'monster', STYLE, VIEW, DIMS);
	expect(surface).not.toBeNull();
	if (!surface) return;
	const inked = inkedCells(surface);
	expect(inked.length).toBeGreaterThan(0);
	expect(rgbaEq(inked[0][2].fg, [11, 22, 33, 255])).toBe(true);
});

test('facing mirrors both glyph orientation and relative placement', () => {
	const source = plainDoc(['/A']);
	const right = renderComposite(source, 'monster', STYLE, VIEW, DIMS);
	const left = renderComposite(
		source,
		'monster',
		STYLE,
		{ ...VIEW, facing: -1 },
		DIMS,
	);
	const xOf = (surface: Cell[][] | null, glyph: string) =>
		inkedCells(surface ?? []).find(([, , cell]) => cell.char === glyph)?.[0] ??
		Number.NaN;
	expect(xOf(right, '/')).toBeLessThan(xOf(right, 'A'));
	expect(xOf(left, '\\')).toBeGreaterThan(xOf(left, 'A'));
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
