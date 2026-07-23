import { expect, test } from 'bun:test';
import type { Entity } from '@mmo/core/entities';
import { Compositor, compositeOver, type RGBA } from '@mmo/render/compositor';
import { COLORS as C } from '../src/theme';
import { drawSpeechBubble } from '../src/ui/speech-bubble';

const NO_CAM = { x: 0, y: 0 };
const FROST: RGBA = C.bubbleBg.toInts();
const SHADE: RGBA = C.bubbleShade.toInts();
const TERRAIN_FG: RGBA = C.terrainFg.toInts();
const TELEGRAPH: RGBA = C.telegraph.toInts();

function eq(a: RGBA, b: RGBA): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function bubbler(bubble: string): Entity {
	return {
		type: 'chaser',
		x: 10,
		y: 10,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 1,
		maxHp: 1,
		hurtT: 0,
		attackT: 0,
		bubble,
	} as unknown as Entity;
}

function fillTerrain(c: Compositor): void {
	for (let y = 0; y < c.heightCells; y++)
		for (let x = 0; x < c.widthCells; x++)
			c.stampGlyph(x, y, '█', TERRAIN_FG, TERRAIN_FG);
}

function findChar(c: Compositor, ch: string): { x: number; y: number } | null {
	const rows = c.surface();
	for (let y = 0; y < rows.length; y++)
		for (let x = 0; x < rows[y].length; x++)
			if (rows[y][x].char === ch) return { x, y };
	return null;
}

// Where the "hi" bubble's first text glyph lands, on an empty surface.
function textCell(): { x: number; y: number } {
	const probe = new Compositor(40, 24);
	drawSpeechBubble(probe, bubbler('hi'), NO_CAM, 40, 24);
	const at = findChar(probe, 'h');
	if (!at) throw new Error('bubble text glyph not found');
	return at;
}

test('a bubble interior frosts the composed terrain beneath it, not a raw terrain guess', () => {
	const c = new Compositor(40, 24);
	fillTerrain(c);
	drawSpeechBubble(c, bubbler('hi'), NO_CAM, 40, 24);

	const at = textCell();
	const cell = c.cell(at.x, at.y);
	expect(cell.char).toBe('h');
	// The interior backdrop is the frost composited over the real terrain, an
	// opaque blended tone — never the raw terrainFg the old sampler would guess.
	expect([...cell.bg]).toEqual([...compositeOver(FROST, TERRAIN_FG)]);
	expect(eq(cell.bg, TERRAIN_FG)).toBe(false);
});

test('a bubble interior reveals a distinct actor colour composed beneath it, not the terrain', () => {
	const at = textCell();
	const actor: RGBA = [200, 50, 50, 255];

	const c = new Compositor(40, 24);
	fillTerrain(c);
	// An opaque actor-coloured cell exactly under the bubble's text glyph.
	c.stampGlyph(at.x, at.y, '█', actor, actor);
	drawSpeechBubble(c, bubbler('hi'), NO_CAM, 40, 24);

	const cell = c.cell(at.x, at.y);
	// Frost composited over the actual actor colour, not over a terrain guess.
	expect([...cell.bg]).toEqual([...compositeOver(FROST, actor)]);
	expect(eq(cell.bg, compositeOver(FROST, TERRAIN_FG))).toBe(false);
});

test('a bubble is frontmost: it wins its cell over a combat glyph and frosts the backdrop', () => {
	const at = textCell();

	const c = new Compositor(40, 24);
	fillTerrain(c);
	// Pass 5: a combat telegraph glyph occupies the cell first.
	c.stampGlyph(at.x, at.y, '✦', TELEGRAPH);
	drawSpeechBubble(c, bubbler('hi'), NO_CAM, 40, 24);

	const cell = c.cell(at.x, at.y);
	// The bubble is frontmost — its text glyph wins over the combat glyph.
	expect(cell.char).toBe('h');
	// Frosted over the real terrain the combat glyph sat on, not a guess.
	expect(cell.bg[3]).toBe(255);
	expect(eq(cell.bg, compositeOver(FROST, TERRAIN_FG))).toBe(true);
});

test('an empty interior cell still renders the frosted shade glyph', () => {
	const c = new Compositor(40, 24);
	fillTerrain(c);
	// "a b" leaves a gap between the words: an empty interior cell.
	drawSpeechBubble(c, bubbler('a b'), NO_CAM, 40, 24);

	const at = findChar(c, '▒');
	expect(at).not.toBeNull();
	const cell = c.cell(at!.x, at!.y);
	expect(cell.char).toBe('▒');
	expect(eq(cell.fg, SHADE)).toBe(true);
	// The shade sits over the composed terrain beneath it.
	expect(eq(cell.bg, TERRAIN_FG)).toBe(true);
});
