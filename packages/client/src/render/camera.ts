import { BOX } from '@mmo/core/entities';

export interface Cam {
	x: number;
	y: number;
}

export const CAMERA = {
	bandWidthFrac: 1 / 3,
	bandHeight: 14,
	snapDeltaCells: 8,
} as const;

export interface CameraState {
	cam: Cam | null;
	center: Cam | null;
	zoneId: string | null;
}

export interface View {
	sw: number;
	sh: number;
	ww: number;
	wh: number;
}

export const initCameraState = (): CameraState => ({
	cam: null,
	center: null,
	zoneId: null,
});

/**
 * Follow the Avatar with a dead-band. The camera carries continuous world-space
 * position — finer than a Pixel — and is NOT rounded here: the playfield feeds
 * `baseCam + kick` into the paint transform, which quantizes the combined
 * world-relative offset to Pixel (half-cell) resolution exactly once (ADR 0038).
 * Rounding the camera here too would round camera and entity independently and
 * reintroduce the shimmer the single combined-transform quantization avoids.
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
		const bandH = Math.min(CAMERA.bandHeight, sh * 0.7);
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

export const CAMERA_KICK = {
	maxCells: 2,
	durationMs: 150,
} as const;

/**
 * A combat-impact camera offset in continuous cells, added to the base camera
 * before the paint transform. Because that transform quantizes at Pixel (half-
 * cell) resolution, the kick now expresses sub-cell shifts as it decays instead
 * of snapping in whole cells (ADR 0038) — impact reads without a jarring jump.
 */
export interface Kick {
	x: number;
	y: number;
}

export const NO_KICK: Kick = { x: 0, y: 0 };

export function applyKick(kick: Kick, dx: number, dy: number): Kick {
	const clamp = (v: number) =>
		Math.max(-CAMERA_KICK.maxCells, Math.min(CAMERA_KICK.maxCells, v));
	return { x: clamp(kick.x + dx), y: clamp(kick.y + dy) };
}

export function stepKick(kick: Kick, dtMs: number): Kick {
	const step =
		CAMERA_KICK.maxCells * (Math.max(0, dtMs) / CAMERA_KICK.durationMs);
	const decay = (v: number) =>
		v > 0 ? Math.max(0, v - step) : Math.min(0, v + step);
	return { x: decay(kick.x), y: decay(kick.y) };
}

export const SPAWN_MARGIN = 4;

export function inView(
	view: { x: number; y: number; w: number; h: number },
	x: number,
	y: number,
	margin = SPAWN_MARGIN,
): boolean {
	return (
		x >= view.x - margin &&
		x <= view.x + view.w + margin &&
		y >= view.y - margin &&
		y <= view.y + view.h + margin
	);
}
