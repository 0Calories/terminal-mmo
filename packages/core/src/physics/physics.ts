import { BOX } from '../entities/archetypes';
import type { Facing, Terrain } from '../entities/types';
import { DEFAULT_MASS, PHYS } from './constants';
import { sweepColumn, sweepRow } from './sweep';

export type AbilityId = 'swing' | 'fire' | 'pounce';

export interface Drive {
	moveX: -1 | 0 | 1;
	jump: boolean;

	/** Scales moveX ground speed for this tick (leaps outrun the walk). */
	moveScale?: number;

	/** Scales the jump impulse when jump fires (flat leaps under-jump). */
	jumpScale?: number;

	face?: Facing;

	commit?: AbilityId;
}

export const IDLE_DRIVE: Drive = { moveX: 0, jump: false };

export interface ImpulseBody {
	vy: number;
	ivx?: number;
	mass?: number;
}

export interface MomentumBody extends ImpulseBody {
	x: number;
	y: number;
	vx: number;
	speed: number;
	facing: Facing;
	onGround: boolean;
}

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
	let vx = drive.moveX * src.speed * (drive.moveScale ?? 1) + ivx;
	let facing = src.facing;
	if (vx > 0) facing = 1;
	else if (vx < 0) facing = -1;

	let vy = src.vy;
	if (drive.jump && src.onGround) vy = -PHYS.jump * (drive.jumpScale ?? 1);

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
