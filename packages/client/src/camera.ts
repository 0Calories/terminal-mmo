// Dead-band camera math — view-only, deliberately NOT in the @mmo/shared sim
// (the server has no camera). The world only scrolls when the Avatar pushes out
// of a central window, so small steps and jumps don't make the whole field (and
// every Monster) shimmer. Output is integer cell offsets — the terminal can't
// position sub-cell, so we don't ease (easing in a cell grid just feels laggy);
// we only change *when* it snaps a whole cell.
import { BOX } from '@mmo/shared';

export interface Cam {
	x: number;
	y: number;
}

export const CAMERA = {
	bandWidthFrac: 1 / 3, // Avatar roams the central third before horizontal scroll
	bandHeight: 14, // taller than a full jump (~6.4 cells) so hops don't scroll
	// A single-frame Avatar move beyond this is a teleport (respawn / portal),
	// not walking — snap-cut instead of chasing it across the World. Normal
	// motion is ~2 cells/frame even at the dt clamp, so 8 is a safe margin.
	snapDeltaCells: 8,
} as const;

/** Persisted camera state. `cam`/`center` are null until the first frame. */
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
 * Advance the camera one frame. Pure given (state, zone, Avatar pos, view).
 * Snap-cuts on the first frame, a Zone change, or a teleport-sized jump;
 * otherwise scrolls only enough to keep the Avatar inside the dead-band window.
 * Always clamps to world bounds.
 *
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
		// snap-centre on the Avatar
		cam = { x: clampX(cx - sw / 2), y: clampY(cy - sh / 2) };
	} else {
		const bandW = sw * CAMERA.bandWidthFrac;
		const bandH = Math.min(CAMERA.bandHeight, sh * 0.7); // shrink on tiny terminals
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
