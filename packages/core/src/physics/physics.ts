// physics — the Momentum-body integrator: input drive + impulses + gravity −
// drag, then axis-separated collision through the shared sweep (ADR 0032).

import { BOX } from '../entities/archetypes';
import type { Facing, Terrain } from '../entities/types';
import { DEFAULT_MASS, PHYS } from './constants';
import { sweepColumn, sweepRow } from './sweep';

/** An ability a Drive may commit; the zone tick resolves it against the committer's archetype profile — physics carries it, combat spends it. */
export type AbilityId = 'swing' | 'fire';

/**
 * The per-tick movement decision a controller feeds into physics — produced
 * from the net Intent for an Avatar, by a Brain for a Monster (glossary:
 * Drive). The simulation consumes Drives without caring who is driving.
 */
export interface Drive {
	moveX: -1 | 0 | 1;
	jump: boolean;
	/**
	 * Aim decoupled from locomotion. The step turns a body toward its
	 * velocity; `face` overrides that after the integration — a committing
	 * melee squares up to its target, a shooter keeps eyes (and its muzzle)
	 * on the target while backpedaling. Absent = let movement decide.
	 */
	face?: Facing;
	/**
	 * Attack commit — the ONLY way any attack starts (ADR 0034). Physics
	 * ignores it; the zone tick resolves it against the archetype profile.
	 */
	commit?: AbilityId;
}

export const IDLE_DRIVE: Drive = { moveX: 0, jump: false };

// The slice of an Entity an impulse touches (ADR 0032: narrow structural views
// over the flat record; callers pass a full Entity and get a full Entity back).
// Deliberately narrower than MomentumBody — only the impulse channel, so a
// shove can be applied to anything that carries one.
export interface ImpulseBody {
	vy: number;
	ivx?: number;
	mass?: number;
}

/**
 * The glossary's Momentum body — the structural slice of an Entity the
 * integrator reads and writes: position + velocity + Mass, plus the drive and
 * collision channels (`speed`, `facing`, `onGround`). Generic-preserving:
 * callers pass a full Entity and get a full Entity back (ADR 0032).
 */
export interface MomentumBody extends ImpulseBody {
	x: number;
	y: number;
	vx: number;
	speed: number;
	facing: Facing;
	onGround: boolean;
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

export function stepEntity<B extends MomentumBody>(
	t: Terrain,
	src: B,
	drive: Drive,
	dt: number,
): { e: B; hitWall: boolean } {
	let ivx = (src.ivx ?? 0) * Math.exp(-PHYS.drag * dt);
	if (Math.abs(ivx) < PHYS.impulseEpsilon) ivx = 0;
	let vx = drive.moveX * src.speed + ivx;
	let facing = src.facing;
	if (vx > 0) facing = 1;
	else if (vx < 0) facing = -1;

	let vy = src.vy;
	if (drive.jump && src.onGround) vy = -PHYS.jump;

	// Horizontal leg: sweep the leading edge across each row of the body's
	// span. Only walls block sideways motion; platforms let a sideways-sliding
	// body pass (the one-way rule, carried by the sweep).
	let hitWall = false;
	let x = src.x + vx * dt;
	const top = Math.floor(src.y);
	const bot = Math.ceil(src.y + BOX.h) - 1;
	if (vx > 0) {
		let wall: number | null = null;
		for (let cy = top; cy <= bot; cy++) {
			const hit = sweepRow(t, cy, src.x + BOX.w, x + BOX.w);
			if (hit !== null && (wall === null || hit < wall)) wall = hit;
		}
		if (wall !== null) {
			x = wall - BOX.w;
			vx = 0;
			ivx = 0;
			hitWall = true;
		}
	} else if (vx < 0) {
		let wall: number | null = null;
		for (let cy = top; cy <= bot; cy++) {
			const hit = sweepRow(t, cy, src.x, x);
			if (hit !== null && (wall === null || hit > wall)) wall = hit;
		}
		if (wall !== null) {
			x = wall + 1;
			vx = 0;
			ivx = 0;
			hitWall = true;
		}
	}

	// Vertical leg: descend-sweep the feet across each column of the body's
	// span — the sweep both encodes the came-from-above guard (a rising body
	// never snaps onto a one-way platform) and lands fast falls on the FIRST
	// crossed surface instead of the destination cell. A rising body never
	// collides: platforms pass per the one-way rule, and entities have never
	// head-bonked on walls (preserved behavior).
	vy += PHYS.grav * dt;
	const prevFeet = src.y + BOX.h;
	let y = src.y + vy * dt;
	let onGround = false;
	if (vy > 0) {
		const l = Math.floor(x);
		const r = Math.ceil(x + BOX.w) - 1;
		let land: number | null = null;
		for (let cx = l; cx <= r; cx++) {
			const hit = sweepColumn(t, cx, prevFeet, y + BOX.h);
			if (hit !== null && (land === null || hit < land)) land = hit;
		}
		if (land !== null) {
			y = land - BOX.h;
			vy = 0;
			onGround = true;
		}
	}

	return {
		e: { ...src, x, y, vx, vy, ivx, onGround, facing: drive.face ?? facing },
		hitWall,
	};
}
