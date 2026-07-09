export const CAMERA_KICK = {
	maxCells: 2,
	durationMs: 150,
} as const;

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
