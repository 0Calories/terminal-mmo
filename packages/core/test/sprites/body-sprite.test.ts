import { describe, expect, test } from 'bun:test';
import {
	type BodyState,
	bodyFrame,
	EMOTE_FPS,
	STRIDE,
} from '../../src/sprites';

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

describe('bodyFrame (pure Animation selector / precedence ladder)', () => {
	test('returns idle when no higher-priority state applies', () => {
		expect(bodyFrame(REST)).toEqual({ animationId: 'idle', frameIndex: 0 });
	});

	test('stagger sits at the top of the ladder, even mid-swing', () => {
		expect(
			bodyFrame({ ...REST, staggered: true, move: 'basic', phase: 'active' })
				.animationId,
		).toBe('hurt');
	});

	test('a basic swing selects its phase Animation (windup/active/recovery)', () => {
		for (const phase of ['windup', 'active', 'recovery'] as const)
			expect(bodyFrame({ ...REST, move: 'basic', phase }).animationId).toBe(
				phase,
			);
	});

	test('airborne selects jump, below combat but above walk', () => {
		expect(bodyFrame({ ...REST, airborne: true }).animationId).toBe('jump');
		expect(
			bodyFrame({ ...REST, airborne: true, move: 'basic', phase: 'windup' })
				.animationId,
		).toBe('windup');
	});

	test('walking distance-indexes the walk animation every STRIDE cells (ADR 0035)', () => {
		expect(bodyFrame({ ...REST, moving: true, distanceX: 0 })).toEqual({
			animationId: 'walk',
			frameIndex: 0,
		});
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: STRIDE - 0.1 }).frameIndex,
		).toBe(0);
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: STRIDE }).frameIndex,
		).toBe(1);
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: 2 * STRIDE }).frameIndex,
		).toBe(0);
		expect(
			bodyFrame({ ...REST, moving: true, distanceX: -STRIDE }).frameIndex,
		).toBe(1);
	});

	test('the gait generalizes: a third walk frame extends the cycle, no type change', () => {
		const at = (distanceX: number) =>
			bodyFrame({ ...REST, moving: true, distanceX }, undefined, 3).frameIndex;
		expect(at(0)).toBe(0);
		expect(at(STRIDE)).toBe(1);
		expect(at(2 * STRIDE)).toBe(2);
		expect(at(3 * STRIDE)).toBe(0);
	});

	test('an emote animations below walk: walking cancels it (ADR 0020 §6)', () => {
		expect(bodyFrame({ ...REST, emote: 'wave' }).animationId).toBe(
			'emote:wave',
		);
		expect(
			bodyFrame({ ...REST, emote: 'wave', moving: true, distanceX: 0 })
				.animationId,
		).toBe('walk');
		expect(
			bodyFrame({ ...REST, emote: 'wave', move: 'basic', phase: 'active' })
				.animationId,
		).toBe('active');
	});

	test('an emote frame is sampled from emoteT so the sweep animates (ADR 0020 §9)', () => {
		expect(bodyFrame({ ...REST, emote: 'wave', emoteT: 0 }).frameIndex).toBe(0);
		expect(
			bodyFrame({ ...REST, emote: 'wave', emoteT: 1 / EMOTE_FPS }).frameIndex,
		).toBe(1);
		expect(
			bodyFrame({ ...REST, emote: 'wave', emoteT: 2 / EMOTE_FPS }).frameIndex,
		).toBe(2);
	});

	test('a loop emote advances its frame by elapsed emoteT, a hold freezes on frame 0 (ADR 0020 §9)', () => {
		expect(bodyFrame({ ...REST, emote: 'dance', emoteT: 0 }).frameIndex).toBe(
			0,
		);
		expect(
			bodyFrame({ ...REST, emote: 'dance', emoteT: 3 / EMOTE_FPS }).frameIndex,
		).toBe(3);
		expect(bodyFrame({ ...REST, emote: 'sit', emoteT: 0 }).frameIndex).toBe(0);
		expect(bodyFrame({ ...REST, emote: 'sit', emoteT: 99 }).frameIndex).toBe(0);
	});

	test('a per-animation fps overrides EMOTE_FPS for that emote, changing frame progression (ADR 0031)', () => {
		const fps = { 'emote:wave': 10 } as const;
		// At 10 fps, emoteT = 1/EMOTE_FPS (0.2s) lands on floor(0.2 * 10) = 2, not 1.
		expect(
			bodyFrame({ ...REST, emote: 'wave', emoteT: 1 / EMOTE_FPS }, fps)
				.frameIndex,
		).toBe(2);
		expect(
			bodyFrame({ ...REST, emote: 'wave', emoteT: 0.5 }, fps).frameIndex,
		).toBe(5);
		// An animation absent from the fps map still uses EMOTE_FPS.
		expect(
			bodyFrame({ ...REST, emote: 'dance', emoteT: 3 / EMOTE_FPS }, fps)
				.frameIndex,
		).toBe(3);
	});
});
