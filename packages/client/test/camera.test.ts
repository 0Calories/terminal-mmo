import { expect, test } from 'bun:test';
import { BOX } from '@mmo/shared';
import {
	CAMERA,
	type CameraState,
	initCameraState,
	stepCamera,
	type View,
} from '../src/camera';

// 80x24 viewport over a 240x40 world — room to scroll on both axes.
const VIEW: View = { sw: 80, sh: 24, ww: 240, wh: 40 };
const Z = 'field-01';

// state with the camera already centred on an Avatar at (ax, ay), as if it had
// been tracking it for a frame (so teleport detection has a baseline).
function settled(ax: number, ay: number): CameraState {
	return stepCamera(initCameraState(), Z, ax, ay, VIEW);
}

test('first frame snap-centres on the Avatar', () => {
	const s = stepCamera(initCameraState(), Z, 100, 20, VIEW);
	// centre = avatar + half-box; cam = centre - half-screen, rounded + clamped
	const cx = 100 + BOX.w / 2;
	expect(s.cam).toEqual({ x: Math.round(cx - 40), y: Math.round(22.5 - 12) });
});

test('the camera holds while the Avatar roams inside the dead-band', () => {
	const s0 = settled(100, 20);
	const s1 = stepCamera(s0, Z, 103, 20, VIEW); // small step, still central
	expect(s1.cam).toEqual(s0.cam); // no shimmer
});

test('a held jump does not scroll the camera vertically', () => {
	const s0 = settled(100, 20);
	const s1 = stepCamera(s0, Z, 100, 14, VIEW); // ~6 cells up, within the band
	expect(s1.cam?.y).toBe(s0.cam?.y);
});

test('the camera scrolls once the Avatar pushes past the band edge', () => {
	// pre-position: camera lagging behind an Avatar near the right band edge,
	// with a near-identical last centre so this is treated as walking, not a jump
	const start: CameraState = {
		cam: { x: 50, y: 11 },
		center: { x: 111, y: 22.5 },
		zoneId: Z,
	};
	const s = stepCamera(start, Z, 110, 20, VIEW); // cx = 112.5
	const bandW = VIEW.sw * CAMERA.bandWidthFrac;
	const rightEdge = (VIEW.sw + bandW) / 2;
	expect(s.cam?.x).toBe(Math.round(112.5 - rightEdge)); // pinned to band edge
	expect(s.cam?.x).toBeGreaterThan(50); // scrolled right
});

test('the camera clamps at the world edge instead of overscrolling', () => {
	const start: CameraState = {
		cam: { x: 5, y: 11 },
		center: { x: 3, y: 22.5 },
		zoneId: Z,
	};
	const s = stepCamera(start, Z, 0, 20, VIEW);
	expect(s.cam?.x).toBe(0); // can't scroll past the left wall
});

test('a teleport-sized jump snap-centres instead of chasing', () => {
	const s0 = settled(50, 20); // cam centred near x=50
	const s = stepCamera(s0, Z, 150, 20, VIEW); // +100 cells in one frame
	const cx = 150 + BOX.w / 2;
	expect(s.cam?.x).toBe(Math.round(cx - 40)); // re-centred, not band-scrolled
});

test('walking never trips the teleport snap', () => {
	// a single max-ish walking step is well under snapDeltaCells
	const s0 = settled(100, 20);
	const s1 = stepCamera(s0, Z, 100 + (CAMERA.snapDeltaCells - 1), 20, VIEW);
	// still inside the band, so the camera holds (would have re-centred on snap)
	expect(s1.cam).toEqual(s0.cam);
});

test('a Zone change snap-centres regardless of position delta', () => {
	const s0 = settled(100, 20);
	const s = stepCamera(s0, 'town-01', 100, 20, VIEW); // same pos, new Zone
	const cx = 100 + BOX.w / 2;
	expect(s.cam).toEqual({ x: Math.round(cx - 40), y: Math.round(22.5 - 12) });
	expect(s.zoneId).toBe('town-01');
});
