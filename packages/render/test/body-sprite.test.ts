import { describe, expect, test } from 'bun:test';
import { DEFAULT_FORM_ID } from '@mmo/core/entities';
import { type BodySprite, FORM_IDS, formById, formFrame, Sprite } from '../src';

describe('the Form registry', () => {
	test('the configured default resolves to a Form with an idle frame', () => {
		expect(FORM_IDS).toContain(DEFAULT_FORM_ID);
		expect(formById(DEFAULT_FORM_ID).frames.idle).toBeDefined();
	});

	test('unknown or absent ids fall back to the configured default', () => {
		const dflt = formById(DEFAULT_FORM_ID);
		expect(formById('no-such-form')).toBe(dflt);
		expect(formById(undefined)).toBe(dflt);
		expect(formById('')).toBe(dflt);
	});

	test('Forms contain cosmetic rendering data rather than gameplay stats', () => {
		const allowed = new Set(['frames', 'grip', 'head', 'baseline', 'fps']);
		for (const id of FORM_IDS)
			for (const key of Object.keys(formById(id)))
				expect(allowed.has(key)).toBe(true);
	});
});

describe('formFrame', () => {
	const idle = new Sprite('I', { defaultKey: 'p' });
	const walkA = new Sprite('A', { defaultKey: 'p' });
	const walkB = new Sprite('B', { defaultKey: 'p' });
	const form: BodySprite = {
		frames: { idle, walk: [walkA, walkB] },
		grip: { x: 0, y: 0 },
		head: { x: 0, y: 0 },
	};

	test('resolves single and repeating multi-frame animations', () => {
		expect(formFrame(form, 'idle')).toBe(idle);
		expect(formFrame(form, 'walk', 0)).toBe(walkA);
		expect(formFrame(form, 'walk', 1)).toBe(walkB);
		expect(formFrame(form, 'walk', 2)).toBe(walkA);
		expect(formFrame(form, 'walk', -1)).toBe(walkB);
	});

	test('falls back to idle when an animation is absent', () => {
		expect(formFrame(form, 'jump')).toBe(idle);
		expect(formFrame(form, 'emote:wave')).toBe(idle);
	});
});
