import { expect, test } from 'bun:test';
import {
	glyphFromQuadrants,
	QUADRANT_GLYPHS,
	quadrantsFromGlyph,
} from '../src/quadrant';

test('bijection: every mask round-trips through its glyph', () => {
	const seen = new Set<string>();
	for (let mask = 0; mask <= 15; mask++) {
		const glyph = glyphFromQuadrants(mask);
		expect(quadrantsFromGlyph(glyph)).toBe(mask);
		seen.add(glyph);
	}
	expect(seen.size).toBe(16);
});

test('spot-check semantics', () => {
	expect(glyphFromQuadrants(0)).toBe(' ');
	expect(glyphFromQuadrants(15)).toBe('█');
	expect(glyphFromQuadrants(3)).toBe('▀');
	expect(glyphFromQuadrants(12)).toBe('▄');
	expect(glyphFromQuadrants(5)).toBe('▌');
	expect(glyphFromQuadrants(10)).toBe('▐');
	expect(glyphFromQuadrants(6)).toBe('▞');
	expect(glyphFromQuadrants(9)).toBe('▚');
});

test('non-block glyphs decompile to undefined', () => {
	expect(quadrantsFromGlyph('▲')).toBeUndefined();
	expect(quadrantsFromGlyph('╱')).toBeUndefined();
	expect(quadrantsFromGlyph('·')).toBeUndefined();
	expect(quadrantsFromGlyph('a')).toBeUndefined();
	expect(quadrantsFromGlyph('')).toBeUndefined();
	expect(quadrantsFromGlyph('██')).toBeUndefined();
});

test('glyphFromQuadrants throws RangeError for out-of-range or non-integer masks', () => {
	expect(() => glyphFromQuadrants(-1)).toThrow(RangeError);
	expect(() => glyphFromQuadrants(16)).toThrow(RangeError);
	expect(() => glyphFromQuadrants(1.5)).toThrow(RangeError);
	expect(() => glyphFromQuadrants(Number.NaN)).toThrow(RangeError);
});

test('QUADRANT_GLYPHS has 16 entries', () => {
	expect(QUADRANT_GLYPHS.length).toBe(16);
});
