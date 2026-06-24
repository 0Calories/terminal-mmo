import { describe, expect, test } from 'bun:test';
import {
	type BodyState,
	bodyFrame,
	DEFAULT_FORM,
	FORMS,
	formById,
	formFrame,
	Sprite,
	STRIDE,
} from '../src';

// A neutral body state: standing still, on the ground, no swing / emote / stagger.
// Each test perturbs the one signal it exercises so the precedence ladder is isolated.
const REST: BodyState = {
	move: 'idle',
	phase: null,
	swingProgress: 0,
	emote: null,
	emoteT: 0,
	airborne: false,
	moving: false,
	distanceX: 0,
	staggered: false,
};

describe('FORMS registry', () => {
	test('the launch humanoid is FORMS[0] and authors the required idle Pose', () => {
		expect(FORMS.length).toBeGreaterThanOrEqual(1);
		expect(FORMS[DEFAULT_FORM].frames.idle).toBeInstanceOf(Sprite);
	});

	test('formById clamps an absent / out-of-range / non-integer index to FORMS[0]', () => {
		expect(formById(0)).toBe(FORMS[0]);
		expect(formById(undefined)).toBe(FORMS[0]);
		expect(formById(-1)).toBe(FORMS[0]);
		expect(formById(FORMS.length)).toBe(FORMS[0]);
		expect(formById(1.5)).toBe(FORMS[0]);
	});
});

describe('formFrame (Pose resolution + idle fallback)', () => {
	test('resolves an authored Pose to its grid', () => {
		expect(formFrame(FORMS[0], 'idle')).toBe(FORMS[0].frames.idle as Sprite);
	});

	test('an unauthored Pose falls back to idle (ADR 0020 §5)', () => {
		// This slice authors only `idle`, so every other Pose resolves to the idle grid.
		const idle = formFrame(FORMS[0], 'idle');
		for (const pose of ['walkA', 'walkB', 'jump', 'windup', 'hurt'] as const)
			expect(formFrame(FORMS[0], pose)).toBe(idle);
		expect(formFrame(FORMS[0], 'emote:wave')).toBe(idle);
	});

	test('the body Pose mirrors left/right (the body grid carries the free mirror)', () => {
		const idle = formFrame(FORMS[0], 'idle');
		// Authored right-facing; facing left reflects the asymmetric body, same width.
		expect(idle.rows(-1)).not.toEqual(idle.rows(1));
		expect(idle.rows(-1)[0].length).toBe(idle.w);
	});
});

describe('bodyFrame (pure Pose selector / precedence ladder)', () => {
	test('returns idle when no higher-priority state applies', () => {
		expect(bodyFrame(REST)).toEqual({ poseId: 'idle', frameIndex: 0 });
	});

	test('stagger sits at the top of the ladder, even mid-swing', () => {
		expect(
			bodyFrame({ ...REST, staggered: true, move: 'basic', phase: 'active' })
				.poseId,
		).toBe('hurt');
	});

	test('a basic swing selects its phase Pose (windup/active/recovery)', () => {
		for (const phase of ['windup', 'active', 'recovery'] as const)
			expect(bodyFrame({ ...REST, move: 'basic', phase }).poseId).toBe(phase);
	});

	test('airborne selects jump, below combat but above walk', () => {
		expect(bodyFrame({ ...REST, airborne: true }).poseId).toBe('jump');
		// A swing in the air still poses the swing, not the jump.
		expect(
			bodyFrame({ ...REST, airborne: true, move: 'basic', phase: 'windup' })
				.poseId,
		).toBe('windup');
	});

	test('walking flips walkA/walkB every STRIDE cells of travelled distance', () => {
		expect(bodyFrame({ ...REST, moving: true, distanceX: 0 }).poseId).toBe(
			'walkA',
		);
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: STRIDE - 0.1 }).poseId,
		).toBe('walkA');
		expect(bodyFrame({ ...REST, moving: true, distanceX: STRIDE }).poseId).toBe(
			'walkB',
		);
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: 2 * STRIDE }).poseId,
		).toBe('walkA');
		// Gait derives from |Δx|, so it is direction-agnostic.
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: -STRIDE }).poseId,
		).toBe('walkB');
	});

	test('an emote poses below walk: walking cancels it (ADR 0020 §6)', () => {
		expect(bodyFrame({ ...REST, emote: 'wave' }).poseId).toBe('emote:wave');
		expect(
			bodyFrame({ ...REST, emote: 'wave', moving: true, distanceX: 0 }).poseId,
		).toBe('walkA');
	});
});
