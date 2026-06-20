import { BOX, PHYS } from './constants';
import { isSolid } from './terrain';
import type { Control, Entity, Terrain } from './types';

/**
 * Advance one entity by one step against the Terrain. Pure: returns a new entity
 * plus whether it bumped a wall (used for monster patrol turn-around).
 *
 * Axis-separated tile collision against the entity's logical BOX. Horizontal
 * speed comes from `entity.speed` so the same function drives Players and
 * Monsters at different speeds; vertical motion is gravity + jump.
 */
export function stepEntity(
	t: Terrain,
	src: Entity,
	ctl: Control,
	dt: number,
): { e: Entity; hitWall: boolean } {
	const e: Entity = { ...src };
	e.vx = ctl.moveX * e.speed;
	if (e.vx > 0) e.facing = 1;
	else if (e.vx < 0) e.facing = -1;
	if (ctl.jump && e.onGround) {
		e.vy = -PHYS.jump;
		e.onGround = false;
	}

	let hitWall = false;

	// horizontal
	e.x += e.vx * dt;
	const top = Math.floor(e.y);
	const bot = Math.ceil(e.y + BOX.h) - 1;
	if (e.vx > 0) {
		const r = Math.ceil(e.x + BOX.w) - 1;
		for (let cy = top; cy <= bot; cy++)
			if (isSolid(t, r, cy)) {
				e.x = r - BOX.w;
				e.vx = 0;
				hitWall = true;
				break;
			}
	} else if (e.vx < 0) {
		const l = Math.floor(e.x);
		for (let cy = top; cy <= bot; cy++)
			if (isSolid(t, l, cy)) {
				e.x = l + 1;
				e.vx = 0;
				hitWall = true;
				break;
			}
	}

	// vertical
	e.vy += PHYS.grav * dt;
	e.y += e.vy * dt;
	const l = Math.floor(e.x);
	const r = Math.ceil(e.x + BOX.w) - 1;
	e.onGround = false;
	if (e.vy > 0) {
		const feet = Math.ceil(e.y + BOX.h) - 1;
		for (let cx = l; cx <= r; cx++)
			if (isSolid(t, cx, feet)) {
				e.y = feet - BOX.h;
				e.vy = 0;
				e.onGround = true;
				break;
			}
	} else if (e.vy < 0) {
		const head = Math.floor(e.y);
		for (let cx = l; cx <= r; cx++)
			if (isSolid(t, cx, head)) {
				e.y = head + 1;
				e.vy = 0;
				break;
			}
	}

	return { e, hitWall };
}
