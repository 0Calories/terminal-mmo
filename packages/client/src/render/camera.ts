import { BOX } from '@mmo/core';

export interface Cam {
	x: number;
	y: number;
}

export const CAMERA = {
	bandWidthFrac: 1 / 3,
	bandHeight: 14, // taller than a full jump (~6.4 cells) so hops don't scroll
	snapDeltaCells: 8, // a single-frame move beyond this is a teleport, not walking
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

// Keep the camera a float — the renderer rounds at draw time; rounding here too double-rounds a followed Avatar and shimmers.
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
