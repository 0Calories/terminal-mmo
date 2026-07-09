import { expect, test } from 'bun:test';
import type { Entity } from '@mmo/core';
import type { OptimizedBuffer } from '@opentui/core';
import { type EffectFrame, VisualEffects } from '../src/effects';
import { HITSTOP_MS } from '../src/effects/hitstop';
import type { VisualEffect } from '../src/effects/project';
import { entity, flatTerrain, seededRng } from './helpers';

const SEED = 0xfacade;
const VIEW = { x: 0, y: 0, w: 64, h: 24 };
const DT = 16;

// The facade draws through OptimizedBuffer's blending call; recording it is
// enough to know which layer painted where.
function stubBuffer(w = VIEW.w, h = VIEW.h) {
	const cells: { x: number; y: number; ch: string }[] = [];
	const buf = {
		width: w,
		height: h,
		setCellWithAlphaBlending(x: number, y: number, ch: string) {
			cells.push({ x, y, ch });
		},
	};
	return { buf: buf as unknown as OptimizedBuffer, cells };
}

function frame(over: Partial<EffectFrame> = {}): EffectFrame {
	return {
		effects: [],
		entities: [],
		terrain: flatTerrain(VIEW.w, VIEW.h),
		view: VIEW,
		...over,
	};
}

function bloodAt(x: number, y: number): VisualEffect {
	return { kind: 'blood', x, y, intensity: 8, dir: 1 };
}

const IMPACT_EFFECT: VisualEffect = {
	kind: 'impact',
	x: 20,
	y: 8,
	intensity: 5,
	dir: 1,
};

function drawn(
	visuals: VisualEffects,
	layer: 'settled' | 'echoes' | 'airborne',
) {
	const { buf, cells } = stubBuffer();
	visuals.draw(buf, { x: VIEW.x, y: VIEW.y }, layer);
	return cells;
}

test('a blood Effect realizes into airborne specks; nothing has settled yet', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame({ effects: [bloodAt(10, 10)] }));

	expect(drawn(visuals, 'airborne').length).toBeGreaterThan(0);
	expect(drawn(visuals, 'settled').length).toBe(0);
});

test('settled blood moves from the airborne layer to the settled layer', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame({ effects: [bloodAt(10, 20)] }));
	for (let i = 0; i < 200; i++) visuals.step(DT, frame());

	expect(drawn(visuals, 'settled').length).toBeGreaterThan(0);
});

test('an off-view Effect is culled: nothing spawns, nothing draws', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame({ effects: [bloodAt(500, 500)] }));

	expect(drawn(visuals, 'airborne').length).toBe(0);
});

test('an impact punches the view offset along the hit direction and decays back', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame({ effects: [IMPACT_EFFECT] }));
	expect(visuals.viewOffset().x).toBeGreaterThan(0);

	// Frozen frames only hold; the kick resumes decaying once the freeze lapses.
	while (visuals.holding()) visuals.hold(DT);
	for (let i = 0; i < 20; i++) visuals.step(DT, frame());
	expect(visuals.viewOffset()).toEqual({ x: 0, y: 0 });
});

test('an impact freezes the view; holding decays it over the hitstop window', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame({ effects: [IMPACT_EFFECT] }));
	expect(visuals.holding()).toBe(true);

	for (let i = 0; i < Math.ceil(HITSTOP_MS / DT); i++) visuals.hold(DT);
	expect(visuals.holding()).toBe(false);
});

test('a blood hit neither kicks nor freezes the view', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame({ effects: [bloodAt(10, 10)] }));

	expect(visuals.holding()).toBe(false);
	expect(visuals.viewOffset()).toEqual({ x: 0, y: 0 });
});

test('a dodging entity leaves an echo on the echoes layer', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	const still: Entity = entity({ id: 1, x: 10, y: 10 });
	visuals.step(DT, frame({ entities: [still] }));
	expect(drawn(visuals, 'echoes').length).toBe(0);

	visuals.step(DT, frame({ entities: [{ ...still, dodgeT: 0.2 }] }));
	expect(drawn(visuals, 'echoes').length).toBeGreaterThan(0);
});

test('a level-up burst is an intent: specks appear without any Effect', () => {
	const visuals = new VisualEffects(seededRng(SEED));
	visuals.step(DT, frame());
	expect(drawn(visuals, 'airborne').length).toBe(0);

	visuals.levelUpBurst(20, 12);
	visuals.step(DT, frame());
	expect(drawn(visuals, 'airborne').length).toBeGreaterThan(0);
});
