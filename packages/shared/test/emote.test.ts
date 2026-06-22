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
