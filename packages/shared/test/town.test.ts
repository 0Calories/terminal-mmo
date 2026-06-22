import { expect, test } from 'bun:test';
import type { GameState, Input, Zone } from '../src';
import {
	activeZone,
	BOX,
	createGame,
	GROUND_TOP,
	loadZones,
	spawnAvatar,
	step,
} from '../src';

const IDLE: Input = { moveX: 0, jump: false, attack: false };

/** The authored Town, freshly parsed (ADR 0008). */
function loadTown(): Zone {
	const town = loadZones().find((z) => z.id === 'town-01');
	if (!town) throw new Error('town-01 missing from authored zones/');
	return town;
}

/** A Player standing in the Town, attacking into thin air. */
function townGame(): GameState {
	const town = loadTown();
	return {
		player: {
			avatar: spawnAvatar(20, GROUND_TOP - BOX.h),
			progress: { level: 1, xp: 0, gold: 0 },
			inventory: [],
			zoneId: town.id,
			log: [],
			nextId: 1,
			rngState: 1,
		},
		world: { zones: { [town.id]: town }, tick: 0 },
	};
}

test('the authored Town is a safe Zone: town-typed with no Monsters or spawns', () => {
	const town = loadTown();
	expect(town.id).toBe('town-01');
	expect(town.type).toBe('town');
	expect(town.monsters.length).toBe(0);
	expect(town.spawns.length).toBe(0);
	expect(town.respawns.length).toBe(0);
	expect(town.projectiles.length).toBe(0);
});

test('the Town stays Monster-free and combat-free across many ticks', () => {
	let g = townGame();
	const ATTACK: Input = { moveX: 0, jump: false, attack: true };
	const startHp = g.player.avatar.hp;
	for (let i = 0; i < 600; i++) {
		g = step(g, i % 2 === 0 ? ATTACK : IDLE, 16);
		const zone = activeZone(g.world, g.player.zoneId);
		expect(zone.monsters.length).toBe(0);
		expect(zone.projectiles.length).toBe(0);
	}
	expect(g.player.avatar.hp).toBe(startHp); // no Monsters means no damage ever dealt
});

test('createGame registers a Town alongside the starter Field', () => {
	const g = createGame();
	const towns = Object.values(g.world.zones).filter((z) => z.type === 'town');
	expect(towns.length).toBe(1);
	expect(towns[0].monsters.length).toBe(0);
});
