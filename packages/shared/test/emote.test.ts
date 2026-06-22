import { expect, test } from 'bun:test';
import { EMOTES, emoteById } from '../src';

test('EMOTES is a non-empty fixed set of distinct ids', () => {
	expect(EMOTES.length).toBeGreaterThan(0);
	const ids = EMOTES.map((e) => e.id);
	expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
	// Every emote carries an id and a non-empty pixel-art Sprite to render.
	for (const e of EMOTES) {
		expect(e.id.length).toBeGreaterThan(0);
		expect(e.sprite.w).toBeGreaterThan(0);
		expect(e.sprite.h).toBeGreaterThan(0);
	}
});

test('emoteById resolves a known id and is undefined for an unknown one', () => {
	const first = EMOTES[0];
	expect(emoteById(first.id)).toEqual(first);
	expect(emoteById('definitely-not-an-emote')).toBeUndefined();
});

// The three expression faces (laugh/cry/angry) must each read distinctly — the
// point of #82. These assert the *features* that carry each expression, not the
// exact art, so a redraw that keeps the intent stays green.
const face = (id: string) => {
	const def = emoteById(id);
	if (!def) throw new Error(`missing emote ${id}`);
	return def.sprite;
};

test('angry shows lowered brows — a dark feature key in its top row', () => {
	const top = face('angry').colorKeys(1)[0];
	expect(top).toContain('k'); // brows painted across the forehead, not a blank face
});

test('cry streams tears — cyan runs down more than one row', () => {
	const rowsWithTears = face('cry')
		.colorKeys(1)
		.filter((r) => r.includes('c'));
	expect(rowsWithTears.length).toBeGreaterThan(1);
});

test('laugh has scrunched squinting eyes — a wide dark eye row', () => {
	const eyeRow = face('laugh').colorKeys(1)[1];
	const darkCells = [...eyeRow].filter((c) => c === 'k').length;
	expect(darkCells).toBeGreaterThanOrEqual(4); // two ≥2-cell happy eyes, not pinpricks
});

test('the three expression faces are pairwise distinct', () => {
	const grids = ['laugh', 'cry', 'angry'].map((id) =>
		face(id).colorKeys(1).join('\n'),
	);
	expect(new Set(grids).size).toBe(grids.length);
});
