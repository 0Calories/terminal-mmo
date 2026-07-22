import { describe, expect, test } from 'bun:test';
import { EMOTES } from '../../src/entities';
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

const emoteId = (lifetime: 'oneshot' | 'loop' | 'hold') => {
	const id = EMOTES.find((emote) => emote.lifetime === lifetime)?.id;
	if (!id) throw new Error(`catalog needs a ${lifetime} fixture`);
	return id;
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

	test('walking distance-indexes the walk animation every configured stride', () => {
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

	test('an Emote animates below walk and combat in the precedence ladder', () => {
		const emote = emoteId('oneshot');
		expect(bodyFrame({ ...REST, emote }).animationId).toBe(`emote:${emote}`);
		expect(
			bodyFrame({ ...REST, emote, moving: true, distanceX: 0 }).animationId,
		).toBe('walk');
		expect(
			bodyFrame({ ...REST, emote, move: 'basic', phase: 'active' }).animationId,
		).toBe('active');
	});

	test('an Emote frame is sampled deterministically from simulation time', () => {
		const emote = emoteId('oneshot');
		expect(bodyFrame({ ...REST, emote, emoteT: 0 }).frameIndex).toBe(0);
		expect(
			bodyFrame({ ...REST, emote, emoteT: 1 / EMOTE_FPS }).frameIndex,
		).toBe(1);
		expect(
			bodyFrame({ ...REST, emote, emoteT: 2 / EMOTE_FPS }).frameIndex,
		).toBe(2);
	});

	test('loop Emotes advance while hold Emotes freeze on their first frame', () => {
		const loop = emoteId('loop');
		const hold = emoteId('hold');
		expect(bodyFrame({ ...REST, emote: loop, emoteT: 0 }).frameIndex).toBe(0);
		expect(
			bodyFrame({ ...REST, emote: loop, emoteT: 3 / EMOTE_FPS }).frameIndex,
		).toBe(3);
		expect(bodyFrame({ ...REST, emote: hold, emoteT: 0 }).frameIndex).toBe(0);
		expect(bodyFrame({ ...REST, emote: hold, emoteT: 99 }).frameIndex).toBe(0);
	});

	test('a per-animation frame rate overrides the global Emote rate', () => {
		const oneshot = emoteId('oneshot');
		const loop = emoteId('loop');
		const fps = { [`emote:${oneshot}`]: EMOTE_FPS * 2 };

		expect(
			bodyFrame({ ...REST, emote: oneshot, emoteT: 1 / EMOTE_FPS }, fps)
				.frameIndex,
		).toBe(2);
		expect(
			bodyFrame({ ...REST, emote: oneshot, emoteT: 0.5 }, fps).frameIndex,
		).toBe(Math.floor(EMOTE_FPS));

		expect(
			bodyFrame({ ...REST, emote: loop, emoteT: 3 / EMOTE_FPS }, fps)
				.frameIndex,
		).toBe(3);
	});
});
