import { expect, test } from 'bun:test';
import { Compositor, type RGBA } from '../src/compositor';

const INK: RGBA = [230, 230, 230, 255];
const PLATE: RGBA = [40, 40, 60, 255];

test('a wide grapheme occupies two cells atomically: lead carries the glyph, next is a blanked continuation', () => {
	const c = new Compositor(4, 1);
	c.stampWideGlyph(1, 0, '字', INK);

	const lead = c.cell(1, 0);
	expect(lead.char).toBe('字');
	expect(lead.wide).toBe('lead');
	expect([...lead.fg]).toEqual([...INK]);

	const cont = c.cell(2, 0);
	expect(cont.wide).toBe('cont');
	// The continuation is blank so the terminal renders the wide glyph once.
	expect(cont.char).toBe(' ');
});

test('a wide grapheme with an authored background stays opaque across both cells', () => {
	const c = new Compositor(4, 1);
	c.stampWideGlyph(0, 0, '字', INK, PLATE);
	expect([...c.cell(0, 0).bg]).toEqual([...PLATE]);
	expect([...c.cell(1, 0).bg]).toEqual([...PLATE]);
});

test('a wide grapheme straddling the right edge is dropped, leaving no partial half', () => {
	const c = new Compositor(3, 1);
	// Lead would sit in the last column (2); its continuation (3) is off-surface.
	c.stampWideGlyph(2, 0, '字', INK);
	const lead = c.cell(2, 0);
	// No partial glyph: the wide grapheme is not emitted at all.
	expect(lead.char).not.toBe('字');
	expect(lead.wide).toBeUndefined();
});

test('a single-column stamp over a wide continuation reclaims the cell', () => {
	const c = new Compositor(4, 1);
	c.stampWideGlyph(0, 0, '字', INK);
	// A later glyph lands on the continuation cell and owns it outright.
	c.stampGlyph(1, 0, 'X', INK);
	const cell = c.cell(1, 0);
	expect(cell.char).toBe('X');
	expect(cell.wide).toBeUndefined();
});
