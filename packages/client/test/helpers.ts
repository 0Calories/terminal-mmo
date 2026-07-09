import type {
	Drop,
	Entity,
	GameState,
	Npc,
	PlayerState,
	Projectile,
	Terrain,
	Zone,
} from '@mmo/core';
import {
	BOX,
	DEFAULT_COSMETICS,
	DEFAULT_WEAPON,
	NPC_BOX,
	PORTAL_BOX,
	parseTerrain,
	rngNext,
	SWING_TOTAL,
} from '@mmo/core';

// mulberry32 with the state threaded for us — the same generator the sim seeds from.
export function seededRng(seed: number): () => number {
	let state = seed | 0;
	return () => {
		const r = rngNext(state);
		state = r.state;
		return r.value;
	};
}

// A clock the test advances by hand, so `dt` per frame is fixed rather than wall time.
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

// 80x28, wider and taller than the 60x20 view, so the camera clamps rather than showing sky.
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
		// Overlapping the Avatar's box, so the frame carries the "talk to" interact prompt.
		{ id: 1, kind: 'vendor', name: 'Mira', x: 17, y: FLOOR, ...NPC_BOX },
		{
			id: 2,
			kind: 'signpost',
			name: 'Sign',
			x: 52,
			y: FLOOR,
			...NPC_BOX,
			lines: ['east: the Dungeon'],
		},
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

	const projectiles = [makeProjectile({ id: 1, x: 38, y: FLOOR + 1, vx: -8 })];

	return {
		id,
		type: 'field',
		terrain: parseTerrain(ROWS),
		monsters: [
			entity({ id: 10, type: 'chaser', x: 34, y: FLOOR, facing: -1 }),
			entity({ id: 11, type: 'brute', x: 44, y: STEP, facing: 1 }),
		],
		projectiles,
		nextProjectileId: 2,
		spawns: [],
		respawns: [],
		nextMonsterId: 12,
		portals: [
			{
				x: 56,
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

/**
 * The fixed scene the golden frame renders: two zones (so a zone change is drivable),
 * a player mid-swing, a co-present Avatar with a Handle and a speech bubble, monsters,
 * an NPC, a signpost, a drop, a portal, and an in-flight Projectile.
 */
export function goldenGame(): GameState {
	// Mid-swing and weaponless, so the frame carries the melee telegraph glyph.
	const avatar = entity({
		id: 1,
		type: 'player',
		x: 20,
		y: FLOOR,
		facing: 1,
		hp: 70,
		maxHp: 100,
		name: 'Neo',
		attackT: SWING_TOTAL * 0.55,
		cosmetics: { hue: 2, hat: 'cap', nameplate: 3, form: 1 },
	});

	// Equipped, so the frame carries the composited weapon layer, a Handle and a bubble.
	const other = entity({
		id: 2,
		type: 'player',
		x: 40,
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
