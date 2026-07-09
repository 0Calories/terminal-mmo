import { expect, test } from 'bun:test';
import type { Effect } from '@mmo/shared';
import {
	AUDIBLE_RADIUS,
	EFFECT_SOUND_MAP,
	effectSoundCues,
	spatialize,
} from '../src/sound/world';

const blood = (x: number, y = 0): Effect => ({
	kind: 'blood',
	x,
	y,
	intensity: 5,
	dir: 1,
});
const gore = (x: number, y = 0): Effect => ({
	kind: 'gore',
	x,
	y,
	intensity: 20,
	dir: 0,
});

test('blood voices a hit, gore voices a death', () => {
	expect(EFFECT_SOUND_MAP.blood).toBe('hit');
	expect(EFFECT_SOUND_MAP.gore).toBe('death');
});

test('spatialize: a sound at the camera centre is centred and full volume', () => {
	const cue = spatialize(50, 50, 40);
	expect(cue).not.toBeNull();
	expect(cue?.pan).toBe(0);
	expect(cue?.volume).toBe(1);
});

test('spatialize: pan follows horizontal offset (right positive, left negative)', () => {
	expect(spatialize(70, 50, 40)?.pan).toBeGreaterThan(0);
	expect(spatialize(30, 50, 40)?.pan).toBeLessThan(0);
});

test('spatialize: off-screen sources hard-pan, never beyond ±1', () => {
	expect(spatialize(1000, 50, 40, 5000)?.pan).toBe(1);
	expect(spatialize(-1000, 50, 40, 5000)?.pan).toBe(-1);
});

test('spatialize: volume attenuates with distance and cuts off past the radius', () => {
	const near = spatialize(60, 50, 40, 100);
	const far = spatialize(140, 50, 40, 100);
	expect(near?.volume).toBeGreaterThan(far?.volume ?? 1);
	expect(spatialize(300, 50, 40, 100)).toBeNull();
});

test('spatialize: vertical position is ignored (no y parameter)', () => {
	expect(spatialize(70, 50, 40)).toEqual(spatialize(70, 50, 40));
});

test('a lone hit and a lone death each produce one cue of their kind', () => {
	expect(effectSoundCues([blood(50)], 50, 40).map((c) => c.kind)).toEqual([
		'hit',
	]);
	expect(effectSoundCues([gore(50)], 50, 40).map((c) => c.kind)).toEqual([
		'death',
	]);
});

test('a kill plays death, not hit+death: coincident blood is suppressed', () => {
	const cues = effectSoundCues([blood(50), gore(50)], 50, 40);
	expect(cues.map((c) => c.kind)).toEqual(['death']);
});

test('a non-lethal hit elsewhere is NOT suppressed by an unrelated death', () => {
	const cues = effectSoundCues([blood(20), gore(50)], 35, 40);
	expect(cues.map((c) => c.kind).sort()).toEqual(['death', 'hit']);
});

test('out-of-range Effects are dropped entirely', () => {
	const cues = effectSoundCues(
		[blood(50), blood(5000)],
		50,
		40,
		AUDIBLE_RADIUS,
	);
	expect(cues).toHaveLength(1);
});
