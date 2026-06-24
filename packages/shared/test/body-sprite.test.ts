import { describe, expect, test } from 'bun:test';
import {
	type BodySprite,
	type BodyState,
	bodyFrame,
	DEFAULT_FORM,
	EMOTE_FPS,
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

	test('the launch Form authors the required walk core as distinct grids (ADR 0020 §5)', () => {
		// `idle`/`walkA`/`walkB` are the required core every Form must author. The two
		// walk Poses are real grids (not idle fallbacks) and differ from each other and
		// from idle, so the stride visibly alternates the feet.
		const idle = formFrame(FORMS[0], 'idle');
		const walkA = formFrame(FORMS[0], 'walkA');
		const walkB = formFrame(FORMS[0], 'walkB');
		expect(walkA).toBeInstanceOf(Sprite);
		expect(walkB).toBeInstanceOf(Sprite);
		expect(walkA).not.toBe(idle);
		expect(walkB).not.toBe(idle);
		expect(walkA.rows(1)).not.toEqual(walkB.rows(1));
		// Same footprint as idle (9×3), so the body anchor is stable across the cycle.
		expect(walkA.w).toBe(idle.w);
		expect(walkA.h).toBe(idle.h);
		expect(walkB.w).toBe(idle.w);
		expect(walkB.h).toBe(idle.h);
	});

	test('an unauthored Pose still falls back to idle (ADR 0020 §5)', () => {
		// Beyond the required core (+ the authored `jump` and the wave/dance/sit emotes),
		// every other Pose resolves to the idle grid until a later slice authors it (the
		// combat leans / hurt).
		const idle = formFrame(FORMS[0], 'idle');
		for (const pose of ['windup', 'active', 'recovery', 'hurt'] as const)
			expect(formFrame(FORMS[0], pose)).toBe(idle);
	});

	test('the launch Form authors the dance loop and the sit hold (ADR 0020 §8/§9)', () => {
		const idle = formFrame(FORMS[0], 'idle');
		// `dance` is a real two-frame loop, each frame the idle footprint, distinct from idle
		// and from each other so the body visibly cycles.
		const d0 = formFrame(FORMS[0], 'emote:dance', 0);
		const d1 = formFrame(FORMS[0], 'emote:dance', 1);
		expect(d0).not.toBe(idle);
		expect(d1.rows(1)).not.toEqual(d0.rows(1));
		expect(formFrame(FORMS[0], 'emote:dance', 2).rows(1)).toEqual(d0.rows(1)); // wraps
		expect(d0.w).toBe(idle.w);
		expect(d0.h).toBe(idle.h);
		// `sit` is a single sustained Pose: any frameIndex resolves to the one grid.
		const s0 = formFrame(FORMS[0], 'emote:sit', 0);
		expect(s0).not.toBe(idle);
		expect(formFrame(FORMS[0], 'emote:sit', 1)).toBe(s0);
		expect(s0.w).toBe(idle.w);
		expect(s0.h).toBe(idle.h);
	});

	test('the launch Form authors the wave emote as a distinct multi-frame sweep (ADR 0020 §9)', () => {
		// `wave` ships as the launch oneshot: a real two-frame sweep (not an idle fallback),
		// each frame the idle footprint so the body anchor is stable, sampled by the
		// selector's frameIndex so the raised arm visibly waves.
		const idle = formFrame(FORMS[0], 'idle');
		const f0 = formFrame(FORMS[0], 'emote:wave', 0);
		const f1 = formFrame(FORMS[0], 'emote:wave', 1);
		expect(f0).toBeInstanceOf(Sprite);
		expect(f0).not.toBe(idle);
		expect(f0.rows(1)).not.toEqual(idle.rows(1));
		expect(f1.rows(1)).not.toEqual(f0.rows(1)); // the two sweep frames differ
		// frameIndex wraps into range, so an out-of-bounds sample is safe.
		expect(formFrame(FORMS[0], 'emote:wave', 2).rows(1)).toEqual(f0.rows(1));
		expect(f0.w).toBe(idle.w);
		expect(f0.h).toBe(idle.h);
	});

	test('the launch Form authors a distinct jump Pose for airborne (ADR 0020 §6)', () => {
		// The airborne pose is a real grid (not the idle fallback) and differs from idle
		// and the walk cycle, so being in the air is immediately legible.
		const idle = formFrame(FORMS[0], 'idle');
		const jump = formFrame(FORMS[0], 'jump');
		expect(jump).toBeInstanceOf(Sprite);
		expect(jump).not.toBe(idle);
		expect(jump.rows(1)).not.toEqual(idle.rows(1));
		expect(jump.rows(1)).not.toEqual(formFrame(FORMS[0], 'walkA').rows(1));
		expect(jump.rows(1)).not.toEqual(formFrame(FORMS[0], 'walkB').rows(1));
		// Same 9×3 footprint as idle, so the grip/head anchors and logical box are stable.
		expect(jump.w).toBe(idle.w);
		expect(jump.h).toBe(idle.h);
	});

	test('the jump Pose mirrors left/right by facing (ADR 0020)', () => {
		const jump = formFrame(FORMS[0], 'jump');
		// Authored right-facing; facing left reflects the asymmetric pose, same width.
		expect(jump.rows(-1)).not.toEqual(jump.rows(1));
		expect(jump.rows(-1)[0].length).toBe(jump.w);
	});

	test('a Form without an authored jump Pose falls back to idle (ADR 0020 §5)', () => {
		// The airborne rung resolves through the same idle fallback, so a Form that only
		// authors the required core still renders (as idle) when it never authors `jump`.
		const idle = new Sprite('x', { defaultKey: 'p' });
		const minimal: BodySprite = {
			frames: { idle },
			grip: { x: 0, y: 0 },
			head: { x: 0, y: 0 },
		};
		expect(formFrame(minimal, 'jump')).toBe(idle);
	});

	test('the walk Poses mirror left/right by facing (ADR 0020)', () => {
		for (const pose of ['walkA', 'walkB'] as const) {
			const grid = formFrame(FORMS[0], pose);
			// Authored right-facing; facing left reflects the asymmetric stride, same width.
			expect(grid.rows(-1)).not.toEqual(grid.rows(1));
			expect(grid.rows(-1)[0].length).toBe(grid.w);
		}
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
		// Combat (and stagger) also outrank the emote — they sit higher on the ladder.
		expect(
			bodyFrame({ ...REST, emote: 'wave', move: 'basic', phase: 'active' })
				.poseId,
		).toBe('active');
	});

	test('an emote frame is sampled from emoteT so the sweep animates (ADR 0020 §9)', () => {
		// frameIndex = floor(emoteT * EMOTE_FPS), so the Pose advances as its timer runs.
		expect(bodyFrame({ ...REST, emote: 'wave', emoteT: 0 }).frameIndex).toBe(0);
		expect(
			bodyFrame({ ...REST, emote: 'wave', emoteT: 1 / EMOTE_FPS }).frameIndex,
		).toBe(1);
		expect(
			bodyFrame({ ...REST, emote: 'wave', emoteT: 2 / EMOTE_FPS }).frameIndex,
		).toBe(2);
	});

	test('a loop emote advances its frame by elapsed emoteT, a hold freezes on frame 0 (ADR 0020 §9)', () => {
		// `dance` (loop) sweeps like the oneshot — the frame is a function of the elapsed
		// emoteT, the deterministic clock every observer shares.
		expect(bodyFrame({ ...REST, emote: 'dance', emoteT: 0 }).frameIndex).toBe(
			0,
		);
		expect(
			bodyFrame({ ...REST, emote: 'dance', emoteT: 3 / EMOTE_FPS }).frameIndex,
		).toBe(3);
		// `sit` (hold) is pinned to frame 0 no matter how long it has been held.
		expect(bodyFrame({ ...REST, emote: 'sit', emoteT: 0 }).frameIndex).toBe(0);
		expect(bodyFrame({ ...REST, emote: 'sit', emoteT: 99 }).frameIndex).toBe(0);
	});
});
