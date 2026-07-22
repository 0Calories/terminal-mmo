import { DEFAULT_WEAPON, SWING_TOTAL } from '@mmo/core/combat';
import {
	BOX,
	DEFAULT_COSMETICS,
	type Drop,
	type Entity,
	type Npc,
	type Projectile,
	type Terrain,
} from '@mmo/core/entities';
import { rngNext } from '@mmo/core/items';
import { parseTerrain } from '@mmo/core/physics';
import type { GameState, PlayerState } from '@mmo/core/protocol';
import { NPC_BOX, PORTAL_BOX, type Zone } from '@mmo/core/zones';

export function seededRng(seed: number): () => number {
	let state = seed | 0;
	return () => {
		const r = rngNext(state);
		state = r.state;
		return r.value;
	};
}

export function manualClock(stepMs: number) {
	let t = 0;
	return {
		now: () => t,
		tick: (): void => {
			t += stepMs;
		},
	};
}

export function makeProjectile(
	over: Partial<Projectile> & Pick<Projectile, 'id'>,
): Projectile {
	return {
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		life: 2,
		damage: 4,
		poiseDamage: 1,
		knockback: 0,
		knockbackUp: 0,
		...over,
	};
}

export function flatTerrain(w: number, h: number, groundTop = h - 2): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++) rows.push((y >= groundTop ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}

export function entity(over: Partial<Entity> & Pick<Entity, 'id'>): Entity {
	return {
		type: 'chaser',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

const GROUND_Y = 22;
const STEP_Y = 19;

const SKY = '.'.repeat(80);
const GROUND = '#'.repeat(80);
const patch = (at: number, run: string) =>
	SKY.slice(0, at) + run + SKY.slice(at + run.length);

const ROWS = [
	...Array(12).fill(SKY),
	patch(26, '====='),
	...Array(6).fill(SKY),
	...Array(3).fill(patch(44, '######')),
	...Array(6).fill(GROUND),
];

const FLOOR = GROUND_Y - BOX.h;
const STEP = STEP_Y - BOX.h;

function goldenZone(id: string): Zone {
	const npcs: Npc[] = [
		{ id: 1, kind: 'vendor', name: 'Mira', x: 17, y: FLOOR, ...NPC_BOX },
	];

	const drops: Drop[] = [
		{
			id: 1,
			owner: 1,
			x: 30,
			y: GROUND_Y - 2,
			w: 2,
			h: 2,
			ttl: 60,
			item: {
				id: 7,
				base: 'sword',
				slot: 'weapon',
				rarity: 'rare',
				affixes: [],
			},
		},
	];

	const projectiles = [makeProjectile({ id: 1, x: 48, y: FLOOR + 1, vx: -8 })];

	return {
		id,
		type: 'field',
		terrain: parseTerrain(ROWS),
		monsters: [
			entity({ id: 10, type: 'chaser', x: 34, y: FLOOR, facing: -1 }),
			entity({ id: 11, type: 'brute', x: 54, y: STEP, facing: 1 }),
		],
		projectiles,
		nextProjectileId: 2,
		spawns: [],
		respawns: [],
		nextMonsterId: 12,
		portals: [
			{
				x: 66,
				y: GROUND_Y - PORTAL_BOX.h,
				...PORTAL_BOX,
				target: 'dungeon',
				arrival: { x: 2, y: 2 },
			},
		],
		npcs,
		drops,
		nextDropId: 2,
	};
}

export function goldenGame(): GameState {
	const avatar = entity({
		id: 1,
		type: 'player',
		x: 40,
		y: FLOOR,
		facing: 1,
		hp: 70,
		maxHp: 100,
		name: 'Neo',
		attackT: SWING_TOTAL * 0.55,
		weapon: DEFAULT_WEAPON,
		cosmetics: { hue: 2, hat: 'cap', nameplate: 3, form: 'buddy' },
	});

	const other = entity({
		id: 2,
		type: 'player',
		x: 50,
		y: FLOOR,
		facing: -1,
		hp: 90,
		maxHp: 100,
		name: 'Trin',
		bubble: 'behind you',
		weapon: DEFAULT_WEAPON,
		cosmetics: DEFAULT_COSMETICS,
	});

	const player: PlayerState = {
		avatar,
		progress: { level: 3, xp: 40, gold: 12 },
		inventory: [],
		zoneId: 'town',
		log: [],
		nextId: 100,
		rngState: 1,
		class: 'warrior',
	};

	return {
		player,
		world: {
			zones: { town: goldenZone('town'), dungeon: goldenZone('dungeon') },
			tick: 0,
		},
		others: [other],
	};
}

export const GOLDEN_VIEW = { width: 60, height: 20 } as const;
