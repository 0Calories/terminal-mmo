import { BOX } from '../entities/archetypes';
import type { Control, Entity, Terrain } from '../entities/types';
import { DEFAULT_MASS, PHYS } from './constants';
import { isSolid, isWall } from './terrain';

// The slice of an Entity an impulse touches (ADR 0032: narrow structural views
// over the flat record; callers pass a full Entity and get a full Entity back).
// Deliberately NOT the glossary's Momentum body — that is the whole integrated
// body (position + velocity + Mass), the view stepEntity will type against when
// it adopts Drives (ADR 0034); this is only the impulse channel.
export interface ImpulseBody {
	vy: number;
	ivx?: number;
	mass?: number;
}

// Horizontal impulse rides the decaying ivx channel, not vx (input rewrites vx each tick).
export function applyImpulse<E extends ImpulseBody>(
	e: E,
	ix: number,
	iy: number,
): E {
	const m = e.mass ?? DEFAULT_MASS;
	return { ...e, ivx: (e.ivx ?? 0) + ix / m, vy: e.vy + iy / m };
}

export function stepEntity(
	t: Terrain,
	src: Entity,
	ctl: Control,
	dt: number,
): { e: Entity; hitWall: boolean } {
	const e: Entity = { ...src };

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
	// Only walls block horizontal motion; platforms let a sideways-sliding body pass.
	if (e.vx > 0) {
		const r = Math.ceil(e.x + BOX.w) - 1;
		for (let cy = top; cy <= bot; cy++)
			if (isWall(t, r, cy)) {
				e.x = r - BOX.w;
				e.vx = 0;
				ivx = 0;
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
	const prevFeetBottom = e.y + BOX.h;
	e.y += e.vy * dt;
	const l = Math.floor(e.x);
	const r = Math.ceil(e.x + BOX.w) - 1;
	e.onGround = false;
	// Came-from-above guard: only land if feet were at/above the surface last tick (else a rising body snaps onto a one-way platform).
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
