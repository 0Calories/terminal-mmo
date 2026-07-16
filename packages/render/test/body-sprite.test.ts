import { describe, expect, test } from 'bun:test';
import { BOX, DEFAULT_FORM_ID } from '@mmo/core/entities';
import { type BodySprite, FORM_IDS, formById, formFrame, Sprite } from '../src';

describe('the Form registry (directory scan, ADR 0031)', () => {
	test('the default Form is discovered and authors the required idle Pose', () => {
		expect(FORM_IDS).toContain(DEFAULT_FORM_ID);
		expect(formById(DEFAULT_FORM_ID).frames.idle).toBeDefined();
	});

	test('formById falls back to the default Form for an unknown or absent id', () => {
		const dflt = formById(DEFAULT_FORM_ID);
		expect(formById('no-such-form')).toBe(dflt);
		expect(formById(undefined)).toBe(dflt);
		expect(formById('')).toBe(dflt);
	});
});

describe('the default Form honours the authoring contract (ADR 0020 §5)', () => {
	const form = formById(DEFAULT_FORM_ID);

	test('authors the required idle / walkA / walkB core as distinct grids', () => {
		const idle = formFrame(form, 'idle');
		const walkA = formFrame(form, 'walkA');
		const walkB = formFrame(form, 'walkB');
		expect(idle).toBeInstanceOf(Sprite);
		expect(walkA).not.toBe(idle);
		expect(walkB).not.toBe(idle);
		expect(walkA.rows(1)).not.toEqual(walkB.rows(1));
	});

	test('authors a distinct airborne jump Pose', () => {
		const idle = formFrame(form, 'idle');
		const jump = formFrame(form, 'jump');
		expect(jump).not.toBe(idle);
		expect(jump.rows(1)).not.toEqual(idle.rows(1));
	});

	test('shares one footprint across the whole frame set', () => {
		const idle = formFrame(form, 'idle');
		for (const pose of ['walkA', 'walkB', 'jump'] as const) {
			const grid = formFrame(form, pose);
			expect(grid.w).toBe(idle.w);
			expect(grid.h).toBe(idle.h);
		}
	});

	test('every authored Pose mirrors left/right by facing', () => {
		for (const pose of ['idle', 'walkA', 'walkB', 'jump'] as const) {
			const grid = formFrame(form, pose);
			expect(grid.rows(-1)[0].length).toBe(grid.w);
		}
	});
});

describe('a Form is purely cosmetic — zero combat effect (ADR 0020 §3)', () => {
	test('a Form carries only art + anchors + fps, never stats or combat numbers', () => {
		const allowed = new Set(['frames', 'grip', 'head', 'baseline', 'fps']);
		for (const id of FORM_IDS)
			for (const key of Object.keys(formById(id)))
				expect(allowed.has(key)).toBe(true);
	});

	test('the logical collision box is one shared constant, independent of Form', () => {
		expect(BOX).toEqual({ w: 5, h: 5 });
	});
});

describe('formFrame (Pose resolution + idle fallback)', () => {
	const form = formById(DEFAULT_FORM_ID);

	test('resolves an authored Pose to its grid', () => {
		expect(formFrame(form, 'idle')).toBe(form.frames.idle as Sprite);
	});

	test('an unauthored Pose falls back to idle (ADR 0020 §5)', () => {
		const idle = formFrame(form, 'idle');
		for (const pose of ['windup', 'active', 'recovery', 'hurt'] as const)
			expect(formFrame(form, pose)).toBe(idle);
	});

	test('the default Form authors the dance loop and the sit hold (ADR 0020 §8/§9)', () => {
		const idle = formFrame(form, 'idle');
		const d0 = formFrame(form, 'emote:dance', 0);
		const d1 = formFrame(form, 'emote:dance', 1);
		expect(d0).not.toBe(idle);
		expect(d1.rows(1)).not.toEqual(d0.rows(1));
		// A 2-frame pose wraps: index 2 == index 0.
		expect(formFrame(form, 'emote:dance', 2).rows(1)).toEqual(d0.rows(1));
		const s0 = formFrame(form, 'emote:sit', 0);
		expect(s0).not.toBe(idle);
		// A single-frame pose ignores the frame index.
		expect(formFrame(form, 'emote:sit', 1)).toBe(s0);
	});

	test('the default Form authors the wave emote as a distinct multi-frame sweep (ADR 0020 §9)', () => {
		const idle = formFrame(form, 'idle');
		const f0 = formFrame(form, 'emote:wave', 0);
		const f1 = formFrame(form, 'emote:wave', 1);
		expect(f0).not.toBe(idle);
		expect(f0.rows(1)).not.toEqual(idle.rows(1));
		expect(f1.rows(1)).not.toEqual(f0.rows(1));
		expect(formFrame(form, 'emote:wave', 2).rows(1)).toEqual(f0.rows(1));
	});

	test('a Form missing a registered emote falls back to idle at runtime (ADR 0020 §5)', () => {
		const idle = new Sprite('x', { defaultKey: 'p' });
		const minimal: BodySprite = {
			frames: { idle },
			grip: { x: 0, y: 0 },
			head: { x: 0, y: 0 },
		};
		expect(formFrame(minimal, 'emote:wave')).toBe(idle);
		expect(formFrame(minimal, 'jump')).toBe(idle);
	});
});
