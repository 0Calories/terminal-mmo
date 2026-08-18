import { DEFAULT_MASS, PHYS } from '../physics/constants';
import { maxHpForLevel } from '../progression/progression';
import { BOX } from './body';
import { boxOf } from './boxes';
import { MONSTERS } from './monsters';
import type { Entity, MonsterType } from './types';

export interface AvatarOptions {
	id?: number;

	weapon?: number;
	offhand?: number;
}

export function spawnAvatar(
	x: number,
	y: number,
	opts: AvatarOptions = {},
): Entity {
	return {
		id: opts.id ?? 1,
		type: 'player',
		x,
		y,
		vx: 0,
		vy: 0,
		speed: PHYS.speed,
		facing: 1,
		onGround: false,
		hp: maxHpForLevel(1),
		maxHp: maxHpForLevel(1),
		hurtT: 0,
		attackT: 0,
		mass: DEFAULT_MASS,
		...(opts.weapon !== undefined ? { weapon: opts.weapon } : {}),
		...(opts.offhand !== undefined ? { offhand: opts.offhand } : {}),
	};
}

/**
 * (x, y) is the authored {@link BOX}-sized spawn slot; the monster's derived
 * box is centred in it with feet kept on the slot's floor, so authored zones
 * stay valid whatever box a monster's sprite derives.
 */
export function spawnMonster(
	type: MonsterType,
	id: number,
	x: number,
	y: number,
	spawnIndex?: number,
): Entity {
	const { stats } = MONSTERS[type];
	const box = boxOf(type);
	return {
		id,
		type,
		x: x + Math.floor((BOX.w - box.w) / 2),
		y: y + BOX.h - box.h,
		vx: 0,
		vy: 0,
		speed: stats.speed,
		facing: 1,
		onGround: false,
		hp: stats.hp,
		maxHp: stats.hp,
		hurtT: 0,
		attackT: 0,
		mass: stats.mass,
		...(stats.poise !== undefined ? { poiseMax: stats.poise } : {}),
		spawnIndex,
	};
}
