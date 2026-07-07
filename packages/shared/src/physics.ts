import { BOX, DEFAULT_MASS, PHYS } from './constants';
import { isSolid } from './terrain';
import type { Control, Entity, Terrain } from './types';

// Add an external impulse to a body's momentum (ADR 0017): the hook a later
// Knockback slice fires on Stagger. Pure — returns a new Entity. The impulse is
// scaled by 1/Mass (a fixed shove rockets a light body, barely nudges a heavy
// one), then split by axis to match how the integrator carries velocity:
// horizontal goes into the decaying `ivx` channel (input rewrites `vx` each
// tick, so a horizontal shove must live apart from it); vertical adds straight
// into `vy`, which already carries momentum under gravity. The shove then plays
// out physically through the same integration — gravity arcs it, drag decays it,
// Terrain stops it.
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

	// Horizontal velocity = input drive (instant, recomputed every tick) + the
	// external-impulse channel, which decays toward 0 under drag and snaps to 0
	// once negligible. With no impulse in flight `ivx` is 0, so this is identical
	// to the pre-momentum-body `vx = moveX * speed` — movement parity holds.
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
	if (e.vx > 0) {
		const r = Math.ceil(e.x + BOX.w) - 1;
		for (let cy = top; cy <= bot; cy++)
			if (isSolid(t, r, cy)) {
				e.x = r - BOX.w;
				e.vx = 0;
				ivx = 0; // a wall absorbs the shove, not just this tick's drive
				hitWall = true;
				break;
			}
	} else if (e.vx < 0) {
		const l = Math.floor(e.x);
		for (let cy = top; cy <= bot; cy++)
			if (isSolid(t, l, cy)) {
				e.x = l + 1;
				e.vx = 0;
				ivx = 0;
				hitWall = true;
				break;
			}
	}
	e.ivx = ivx;

	e.vy += PHYS.grav * dt;
	// Feet position (world-y of the box's bottom edge) BEFORE this tick's vertical
	// move — the came-from-above reference for one-way landing below.
	const prevFeetBottom = e.y + BOX.h;
	e.y += e.vy * dt;
	const l = Math.floor(e.x);
	const r = Math.ceil(e.x + BOX.w) - 1;
	e.onGround = false;
	// One-way platforms (#262): every solid still walls off HORIZONTAL motion
	// (handled above), but vertically a solid only stops a DESCENDING body — a
	// rising body passes straight through (no head bonk), so there is no head-snap
	// branch. The came-from-above guard (`prevFeetBottom <= surface`) refuses the
	// landing unless the feet were at or above the tile's top surface last tick,
	// so a body that peaks with its feet still below the surface keeps falling
	// instead of snapping up onto it (no teleport glitch). Current zones have no
	// ceilings, so global one-way behaviour needs no per-tile type (ADR 0024).
	if (e.vy > 0) {
		const feet = Math.ceil(e.y + BOX.h) - 1;
		// The tile row's top surface sits at world-y `feet`.
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
