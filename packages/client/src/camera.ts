// View-only, deliberately NOT in the @mmo/shared sim (the server has no camera). The
// world scrolls only when the Avatar pushes out of a central window, so small steps
// and jumps don't make the whole field shimmer.
import { BOX } from '@mmo/shared';

export interface Cam {
	x: number;
	y: number;
}

export const CAMERA = {
	bandWidthFrac: 1 / 3,
	bandHeight: 14, // taller than a full jump (~6.4 cells) so hops don't scroll
	// A single-frame move beyond this is a teleport (respawn / portal), not walking —
	// snap-cut instead of chasing it. Normal motion is ~2 cells/frame, so 8 is safe.
	snapDeltaCells: 8,
} as const;

export interface CameraState {
	cam: Cam | null;
	center: Cam | null; // last Avatar centre, used to detect teleports
	zoneId: string | null;
}

export interface View {
	sw: number; // screen width (cells)
	sh: number; // screen height (cells)
	ww: number; // world width (cells)
	wh: number; // world height (cells)
}

export const initCameraState = (): CameraState => ({
	cam: null,
	center: null,
	zoneId: null,
});

/**
 * The camera is kept as a FLOAT, not rounded here: the renderer rounds at draw time.
 * Rounding the camera too would double-round a followed Avatar (`round(p.x - round(p.x
 * - edge))`) at different sub-cell phases, bouncing ±1 cell frame to frame (shimmer).
 */
export function stepCamera(
	state: CameraState,
	zoneId: string,
	avatarX: number,
	avatarY: number,
	view: View,
): CameraState {
	const { sw, sh, ww, wh } = view;
	const cx = avatarX + BOX.w / 2;
	const cy = avatarY + BOX.h / 2;

	const clampX = (x: number) => Math.max(0, Math.min(x, Math.max(0, ww - sw)));
	const clampY = (y: number) => Math.max(0, Math.min(y, Math.max(0, wh - sh)));

	const teleported =
		state.center !== null &&
		(Math.abs(cx - state.center.x) > CAMERA.snapDeltaCells ||
			Math.abs(cy - state.center.y) > CAMERA.snapDeltaCells);

	let cam: Cam;
	if (state.cam === null || zoneId !== state.zoneId || teleported) {
		cam = { x: clampX(cx - sw / 2), y: clampY(cy - sh / 2) };
	} else {
		const bandW = sw * CAMERA.bandWidthFrac;
		const bandH = Math.min(CAMERA.bandHeight, sh * 0.7); // cap on tiny terminals
		let camX = state.cam.x;
		let camY = state.cam.y;
		const screenX = cx - camX;
		const screenY = cy - camY;
		if (screenX < (sw - bandW) / 2) camX = cx - (sw - bandW) / 2;
		else if (screenX > (sw + bandW) / 2) camX = cx - (sw + bandW) / 2;
		if (screenY < (sh - bandH) / 2) camY = cy - (sh - bandH) / 2;
		else if (screenY > (sh + bandH) / 2) camY = cy - (sh + bandH) / 2;
		cam = { x: clampX(camX), y: clampY(camY) };
	}

	return { cam, center: { x: cx, y: cy }, zoneId };
}

// --- Camera-kick (ADR 0017 §13c) --------------------------------------------
//
// A short, decaying viewport offset on a "big moment", layered on the follow camera.
// A single directional pop, not a rumble — micro-shake reads as jank at cell granularity.

export const CAMERA_KICK = {
	maxCells: 2, // hard clamp on the offset magnitude (≤2 cells, per ADR)
	durationMs: 150, // a kick at full magnitude decays linearly to zero in this long
} as const;

export interface Kick {
	x: number;
	y: number;
}

export const NO_KICK: Kick = { x: 0, y: 0 };

// Add a kick impulse, clamping each axis into ±maxCells so a burst of breaks can't
// stack into a lurch.
export function applyKick(kick: Kick, dx: number, dy: number): Kick {
	const clamp = (v: number) =>
		Math.max(-CAMERA_KICK.maxCells, Math.min(CAMERA_KICK.maxCells, v));
	return { x: clamp(kick.x + dx), y: clamp(kick.y + dy) };
}

// Decay a kick toward zero: a linear ramp reaching EXACTLY zero within `durationMs`,
// so the offset never lingers or overshoots. `dtMs` is wall time.
export function stepKick(kick: Kick, dtMs: number): Kick {
	const step =
		CAMERA_KICK.maxCells * (Math.max(0, dtMs) / CAMERA_KICK.durationMs);
	const decay = (v: number) =>
		v > 0 ? Math.max(0, v - step) : Math.min(0, v + step);
	return { x: decay(kick.x), y: decay(kick.y) };
}
