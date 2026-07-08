import { BOX, DEFAULT_MASS, PHYS } from './constants';
import { isSolid, isWall } from './terrain';
import type { Control, Entity, Terrain } from './types';

// Add an external impulse to a body's momentum, scaled by 1/Mass. Horizontal goes into
// the decaying `ivx` channel — input rewrites `vx` each tick, so a shove must live apart
// from it — while vertical adds straight into `vy` (ADR 0017).
export function applyImpulse(e: Entity, ix: number, iy: number): Entity {
	const m = e.mass ?? DEFAULT_MASS;
	return { ...e, ivx: (e.ivx ?? 0) + ix / m, vy: e.vy + iy / m };
}

// Axis-separated tile collision against the entity's logical BOX. `hitWall` in
// the result feeds monster patrol turn-around.
export function stepEntity(
	t: Terrain,
	src: Entity,
	ctl: Control,
	dt: number,
): { e: Entity; hitWall: boolean } {
	const e: Entity = { ...src };

	// Horizontal velocity = input drive (recomputed each tick) + the external-impulse
	// channel, which decays under drag and snaps to 0 once negligible.
	let ivx = (e.ivx ?? 0) * Math.exp(-PHYS.drag * dt);
	if (Math.abs(ivx) < PHYS.impulseEpsilon) ivx = 0;
	e.vx = ctl.moveX * e.speed + ivx;
	if (e.vx > 0) e.facing = 1;
	else if (e.vx < 0) e.facing = -1;
	if (ctl.jump && e.onGround) {
		e.vy = -PHYS.jump;
		e.onGround = false;
	}

	let hitWall = false;

	e.x += e.vx * dt;
	const top = Math.floor(e.y);
	const bot = Math.ceil(e.y + BOX.h) - 1;
	// Only WALLS block horizontal motion, never one-way platforms: a body sliding sideways
	// while it rises through a platform passes it instead of snagging (ADR 0026).
	if (e.vx > 0) {
		const r = Math.ceil(e.x + BOX.w) - 1;
		for (let cy = top; cy <= bot; cy++)
			if (isWall(t, r, cy)) {
				e.x = r - BOX.w;
				e.vx = 0;
				ivx = 0; // a wall absorbs the shove, not just this tick's drive
				hitWall = true;
				break;
			}
	} else if (e.vx < 0) {
		const l = Math.floor(e.x);
		for (let cy = top; cy <= bot; cy++)
			if (isWall(t, l, cy)) {
				e.x = l + 1;
				e.vx = 0;
				ivx = 0;
				hitWall = true;
				break;
			}
	}
	e.ivx = ivx;

	e.vy += PHYS.grav * dt;
	// Feet world-y before this tick's vertical move — the came-from-above reference below.
	const prevFeetBottom = e.y + BOX.h;
	e.y += e.vy * dt;
	const l = Math.floor(e.x);
	const r = Math.ceil(e.x + BOX.w) - 1;
	e.onGround = false;
	// One-way platforms (#262): both walls and platforms stop a descending body, but a
	// rising body passes through (no head-snap branch). The came-from-above guard
	// (`prevFeetBottom <= feet`) refuses the landing unless the feet were at or above the
	// surface last tick, so a body peaking below it keeps falling instead of teleporting up.
	if (e.vy > 0) {
		const feet = Math.ceil(e.y + BOX.h) - 1;
		for (let cx = l; cx <= r; cx++)
			if (isSolid(t, cx, feet) && prevFeetBottom <= feet) {
				e.y = feet - BOX.h;
				e.vy = 0;
				e.onGround = true;
				break;
			}
	}

	return { e, hitWall };
}
