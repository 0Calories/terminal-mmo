import { expect, test } from 'bun:test';
import { parseTerrain } from '@mmo/core/physics';
import { Compositor } from '@mmo/render/compositor';
import { drawTerrain } from '@mmo/render/scene';

// A single solid column (x = 1) that is interior below its top row.
const COLUMN = parseTerrain(['.#..', '.#..', '.#..', '.#..']);
const INTERIOR_Y = 2;

test('Pixel-authored terrain shifts by a sub-cell with a half-cell camera, straddling the cell boundary', () => {
	const aligned = new Compositor(4, 4);
	drawTerrain(aligned, COLUMN, { x: 0, y: 0 });
	// Aligned: the column owns one whole cell.
	expect(aligned.cell(1, INTERIOR_Y).char).toBe('█');
	expect(aligned.cell(0, INTERIOR_Y).char).toBe(' ');

	const shifted = new Compositor(4, 4);
	drawTerrain(shifted, COLUMN, { x: 0.5, y: 0 });
	// A half-cell camera moves the whole terrain grid left by one Pixel, so the
	// column straddles two cells instead of jumping a whole cell.
	expect(shifted.cell(0, INTERIOR_Y).char).toBe('▐');
	expect(shifted.cell(1, INTERIOR_Y).char).toBe('▌');
});

test('terrain at a fixed half-cell camera is rigid — identical frame to frame', () => {
	const cam = { x: 2.5, y: 1.5 };
	const a = new Compositor(4, 4);
	const b = new Compositor(4, 4);
	drawTerrain(a, COLUMN, cam);
	drawTerrain(b, COLUMN, cam);
	expect(a.surface()).toEqual(b.surface());
});
