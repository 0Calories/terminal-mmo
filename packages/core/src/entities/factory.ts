// Per-kind Entity factories — the one place required-vs-absent Entity fields
// are decided (ADR 0032). Spawn sites never write field-bag literals; they say
// what to spawn, and the factory says what an Entity of that kind looks like.

import { DEFAULT_MASS, PHYS } from '../physics/constants';
import { maxHpForLevel } from '../progression/progression';
import { ARCHETYPES, type ArchetypeProfile } from './archetypes';
import type { Entity, MonsterType } from './types';

export interface AvatarOptions {
	/** Session id server-side; the solo sim's Avatar keeps the default 1. */
	id?: number;
	/** Equipped weapon id; absent means DEFAULT_WEAPON at use sites. */
	weapon?: number;
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
	};
}

export function spawnMonster(
	type: MonsterType,
	id: number,
	x: number,
	y: number,
	spawnIndex?: number,
): Entity {
	const p: ArchetypeProfile = ARCHETYPES[type];
	return {
		id,
		type,
		x,
		y,
		vx: 0,
		vy: 0,
		speed: p.speed,
		facing: 1,
		onGround: false,
		hp: p.hp,
		maxHp: p.hp,
		hurtT: 0,
		attackT: 0,
		mass: p.mass,
		...(p.poiseMax !== undefined ? { poiseMax: p.poiseMax } : {}),
		spawnIndex,
	};
}
