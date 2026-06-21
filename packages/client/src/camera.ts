// View-only, deliberately NOT in the @mmo/shared sim (the server has no camera).
// The world only scrolls when the Avatar pushes out of a central window, so
// small steps and jumps don't make the whole field (and every Monster) shimmer.
import { BOX } from '@mmo/shared';

export interface Cam {
	x: number;
	y: number;
}

export const CAMERA = {
	bandWidthFrac: 1 / 3,
	bandHeight: 14, // taller than a full jump (~6.4 cells) so hops don't scroll
	// A single-frame move beyond this is a teleport (respawn / portal), not
	// walking — snap-cut instead of chasing it. Normal motion is ~2 cells/frame
	// even at the dt clamp, so 8 is a safe margin.
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
 * The camera is kept as a FLOAT, not rounded here: the renderer rounds at draw
 * time (terrain on the integer grid, entities relative to the float camera). If
 * we rounded the camera too, a followed Avatar would be `round(p.x - round(p.x
 * - edge))` — two roundings at different sub-cell phases — which bounces ±1 cell
 * frame to frame (sprite shimmer). Holding the float here makes a pinned Avatar
 * render at `round(edge)`, dead stable.
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
