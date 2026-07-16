import { expect, test } from 'bun:test';
import { BOX } from '@mmo/core/entities';
import {
	CAMERA,
	type CameraState,
	initCameraState,
	stepCamera,
	type View,
} from '../src/render/camera';

const VIEW: View = { sw: 80, sh: 24, ww: 240, wh: 40 };
const Z = 'field-01';

function settled(ax: number, ay: number): CameraState {
	return stepCamera(initCameraState(), Z, ax, ay, VIEW);
}

test('first frame snap-centres on the Avatar', () => {
	const s = stepCamera(initCameraState(), Z, 100, 20, VIEW);
	const cx = 100 + BOX.w / 2;
	expect(s.cam).toEqual({ x: cx - 40, y: 22.5 - 12 });
});

test('the camera holds while the Avatar roams inside the dead-band', () => {
	const s0 = settled(100, 20);
	const s1 = stepCamera(s0, Z, 103, 20, VIEW);
	expect(s1.cam).toEqual(s0.cam);
});

test('a held jump does not scroll the camera vertically', () => {
	const s0 = settled(100, 20);
	const s1 = stepCamera(s0, Z, 100, 14, VIEW);
	expect(s1.cam?.y).toBe(s0.cam?.y);
});

test('the camera scrolls once the Avatar pushes past the band edge', () => {
	// near-identical last centre so this is treated as walking, not a jump
	const start: CameraState = {
		cam: { x: 50, y: 11 },
		center: { x: 111, y: 22.5 },
		zoneId: Z,
	};
	const s = stepCamera(start, Z, 110, 20, VIEW);
	const bandW = VIEW.sw * CAMERA.bandWidthFrac;
	const rightEdge = (VIEW.sw + bandW) / 2;
	expect(s.cam?.x).toBeCloseTo(112.5 - rightEdge);
	expect(s.cam?.x).toBeGreaterThan(50);
});

test('the camera clamps at the world edge instead of overscrolling', () => {
	const start: CameraState = {
		cam: { x: 5, y: 11 },
		center: { x: 3, y: 22.5 },
		zoneId: Z,
	};
	const s = stepCamera(start, Z, 0, 20, VIEW);
	expect(s.cam?.x).toBe(0);
});

test('a teleport-sized jump snap-centres instead of chasing', () => {
	const s0 = settled(50, 20);
	const s = stepCamera(s0, Z, 150, 20, VIEW);
	const cx = 150 + BOX.w / 2;
	expect(s.cam?.x).toBeCloseTo(cx - 40);
});

test('walking never trips the teleport snap', () => {
	// just under snapDeltaCells and inside the band, so the camera holds
	const s0 = settled(100, 20);
	const s1 = stepCamera(s0, Z, 100 + (CAMERA.snapDeltaCells - 1), 20, VIEW);
	expect(s1.cam).toEqual(s0.cam);
});

test('a Zone change snap-centres regardless of position delta', () => {
	const s0 = settled(100, 20);
	const s = stepCamera(s0, 'town-01', 100, 20, VIEW);
	const cx = 100 + BOX.w / 2;
	expect(s.cam).toEqual({ x: cx - 40, y: 22.5 - 12 });
	expect(s.zoneId).toBe('town-01');
});

test('the Avatar screen column never bounces while walking (no double-round shimmer)', () => {
	let s = settled(60, 20);
	let prev = -Infinity;
	let x = 60;
	for (let i = 0; i < 400; i++) {
		x += 0.3;
		s = stepCamera(s, Z, x, 20, VIEW);
		const screenCol = Math.round(x + BOX.w / 2 - (s.cam?.x ?? 0));
		expect(screenCol).toBeGreaterThanOrEqual(prev);
		prev = screenCol;
	}
});

import {
	applyKick,
	CAMERA_KICK,
	inView,
	type Kick,
	NO_KICK,
	SPAWN_MARGIN,
	stepKick,
} from '../src/render/camera';

const mag = (k: Kick) => Math.max(Math.abs(k.x), Math.abs(k.y));

test('applyKick clamps each axis to ±maxCells (≤2 cells)', () => {
	const k = applyKick(NO_KICK, 100, -100);
	expect(k.x).toBe(CAMERA_KICK.maxCells);
	expect(k.y).toBe(-CAMERA_KICK.maxCells);
	const k2 = applyKick(k, 50, -50);
	expect(mag(k2)).toBeLessThanOrEqual(CAMERA_KICK.maxCells);
});

test('stepKick decays a kick monotonically toward zero and reaches exactly 0 within the duration', () => {
	let k = applyKick(NO_KICK, CAMERA_KICK.maxCells, -CAMERA_KICK.maxCells);
	let prev = mag(k);
	let elapsed = 0;
	const dt = 16;
	for (let i = 0; i < Math.ceil(CAMERA_KICK.durationMs / dt); i++) {
		k = stepKick(k, dt);
		elapsed += dt;
		const m = mag(k);
		expect(m).toBeLessThanOrEqual(prev);
		expect(k.x).toBeGreaterThanOrEqual(0);
		expect(k.y).toBeLessThanOrEqual(0);
		prev = m;
	}
	expect(elapsed).toBeGreaterThanOrEqual(CAMERA_KICK.durationMs);
	expect(k).toEqual({ x: 0, y: 0 });
});

test('stepKick clamps the decremented value at zero (never overshoots past 0)', () => {
	const k = stepKick({ x: 0.1, y: -0.1 }, CAMERA_KICK.durationMs);
	expect(k).toEqual({ x: 0, y: 0 });
});

test('inView pads the view by the spawn margin: a just-off-screen effect still spawns', () => {
	const view = { x: 10, y: 5, w: 60, h: 20 };
	expect(inView(view, 40, 15)).toBe(true);
	expect(inView(view, 10 - SPAWN_MARGIN, 5)).toBe(true);
	expect(inView(view, 10 + 60 + SPAWN_MARGIN, 25)).toBe(true);
	expect(inView(view, 10 - SPAWN_MARGIN - 1, 15)).toBe(false);
	expect(inView(view, 40, 5 + 20 + SPAWN_MARGIN + 1)).toBe(false);
	expect(inView(view, 500, 500)).toBe(false);
});
