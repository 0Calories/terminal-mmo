import { expect, test } from 'bun:test';
import type { GameState, Input, PlayerState, Projectile, Zone } from '../src';
import {
	activeZone,
	BOX,
	createGame,
	createGameFromZones,
	GROUND_TOP,
	loadZones,
	MONSTER,
	SHOOTER,
	spawnAvatar,
	spawnMonster,
	step,
	XP_PER_KILL,
} from '../src';
import { flatTerrain } from './helpers';

const IDLE: Input = { moveX: 0, jump: false, attack: false };

test('createGame separates Player state from the World of Zones', () => {
	const g = createGame();
	expect(g.world.tick).toBe(0);
	expect(g.player.avatar.type).toBe('player');
	expect(g.player.zoneId in g.world.zones).toBe(true);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.type).toBe('town'); // the Player spawns into the safe hub
	expect(zone.monsters.length).toBe(0); // a town has no Monster spawns
});

test('createGameFromZones seeds the sim from an explicit Zone set + start id', () => {
	const zones = loadZones();
	const field = zones.find((z) => z.type === 'field');
	if (!field) throw new Error('expected an authored field Zone');
	const g = createGameFromZones(zones, field.id);
	// Player spawns in the requested start Zone, not the default first Zone.
	expect(g.player.zoneId).toBe(field.id);
	// Every loaded Zone is in the World so portal travel between them works.
	for (const z of zones) expect(z.id in g.world.zones).toBe(true);
	expect(g.world.tick).toBe(0);
	expect(g.player.avatar.type).toBe('player');
});

test('createGameFromZones falls back to the first Zone for an unknown start id', () => {
	const zones = loadZones();
	const g = createGameFromZones(zones, 'no-such-zone');
	expect(g.player.zoneId).toBe(zones[0].id);
});

test('step advances the World tick', () => {
	expect(step(createGame(), IDLE, 16).world.tick).toBe(1);
});

test('step is deterministic for identical seed + inputs', () => {
	let a = createGame(7);
	let b = createGame(7);
	const seq: Input = { moveX: 1, jump: false, attack: true };
	for (let i = 0; i < 40; i++) {
		a = step(a, seq, 16);
		b = step(b, seq, 16);
	}
	expect(b.player.avatar.x).toBe(a.player.avatar.x);
	expect(b.player.inventory.length).toBe(a.player.inventory.length);
	expect(b.player.progress.xp).toBe(a.player.progress.xp);
	expect(activeZone(b.world, b.player.zoneId).monsters.length).toBe(
		activeZone(a.world, a.player.zoneId).monsters.length,
	);
});

// player at x, one chaser directly in front on flat ground, in one Field Zone
function adjacentGame(monsterHp?: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	if (monsterHp !== undefined) {
		m.hp = monsterHp;
		m.maxHp = monsterHp;
	}
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [m],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 3,
	};
	const player: PlayerState = {
		avatar: spawnAvatar(20, y),
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		zoneId: zone.id,
		log: [],
		nextId: 1,
		rngState: 1,
	};
	return { player, world: { zones: { [zone.id]: zone }, tick: 0 } };
}

test('attacking damages an adjacent monster', () => {
	const g = step(adjacentGame(), { moveX: 0, jump: false, attack: true }, 16);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.monsters[0].hp).toBe(MONSTER.chaserHp - 8);
});

test('killing a monster grants XP and an instanced loot drop', () => {
	const g = step(adjacentGame(4), { moveX: 0, jump: false, attack: true }, 16);
	expect(activeZone(g.world, g.player.zoneId).monsters.length).toBe(0);
	expect(g.player.inventory.length).toBe(1);
	expect(g.player.progress.xp).toBe(XP_PER_KILL);
	expect(g.player.inventory[0].id).toBe(1); // assigned from the Player's nextId
});

// one chaser sharing the Avatar's x on flat ground, facing right — the
// on-top-of-you case where naive homing would flip-flop direction each frame.
function stackedGame(): GameState {
	const y = GROUND_TOP - BOX.h;
	const m = spawnMonster('chaser', 2, 40, y);
	m.onGround = true;
	m.facing = 1;
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [m],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 3,
	};
	const player: PlayerState = {
		avatar: spawnAvatar(40, y),
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		zoneId: zone.id,
		log: [],
		nextId: 1,
		rngState: 1,
	};
	return { player, world: { zones: { [zone.id]: zone }, tick: 0 } };
}

test('a chaser inside the deadzone holds position and keeps its facing', () => {
	let g = stackedGame();
	const start = activeZone(g.world, g.player.zoneId).monsters[0];
	expect(start.x).toBe(40); // precondition: stacked on the Avatar (adx 0)
	for (let i = 0; i < 30; i++) {
		g = step(g, IDLE, 16);
		const m = activeZone(g.world, g.player.zoneId).monsters[0];
		expect(m.x).toBe(40); // never drifts chasing a sub-cell dx
		expect(m.facing).toBe(1); // never flips frame-to-frame
	}
});

test('a chaser outside the deadzone still closes in on the Avatar', () => {
	const g = step(adjacentGame(), IDLE, 16);
	const m = activeZone(g.world, g.player.zoneId).monsters[0];
	expect(m.x).toBeLessThan(20 + BOX.w); // moved left toward the Avatar at x=20
});

// player at x=40, one shooter `gap` cells to the right on flat ground.
function shooterGame(gap: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const m = spawnMonster('shooter', 2, 40 + gap, y);
	m.onGround = true;
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [m],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 3,
	};
	const player: PlayerState = {
		avatar: spawnAvatar(40, y),
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		zoneId: zone.id,
		log: [],
		nextId: 1,
		rngState: 1,
	};
	return { player, world: { zones: { [zone.id]: zone }, tick: 0 } };
}

test('a shooter with the Avatar in range fires a projectile and goes on cooldown', () => {
	const g = step(shooterGame(30), IDLE, 16);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.projectiles.length).toBe(1);
	expect(zone.monsters[0].attackT).toBeGreaterThan(0);
});

test('a shooter on cooldown does not fire again', () => {
	let g = step(shooterGame(30), IDLE, 16);
	const first = activeZone(g.world, g.player.zoneId).projectiles.length;
	g = step(g, IDLE, 16); // still on cooldown
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(first);
});

test('a shooter does not fire when the Avatar is out of range', () => {
	const g = step(shooterGame(SHOOTER.aggro + 10), IDLE, 16);
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(0);
});

test('a shooter backs away when the Avatar gets too close', () => {
	const g = step(shooterGame(SHOOTER.keepDist - 5), IDLE, 16);
	const m = activeZone(g.world, g.player.zoneId).monsters[0];
	// player is at 40, shooter started to its right; retreating means moving right
	expect(m.x).toBeGreaterThan(40 + SHOOTER.keepDist - 5);
});

test('a projectile overlapping the Avatar damages it and applies i-frames', () => {
	const y = GROUND_TOP - BOX.h;
	const avatar = spawnAvatar(40, y);
	const proj: Projectile = {
		id: 1,
		x: avatar.x + 1,
		y: avatar.y + 1,
		vx: 0,
		vy: 0,
		life: 2,
		damage: SHOOTER.projDamage,
		ownerId: 2,
	};
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [],
		projectiles: [proj],
		nextProjectileId: 2,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 3,
	};
	const before = avatar.hp;
	const g = step(
		{
			player: {
				avatar,
				progress: { level: 1, xp: 0, gold: 0 },
				inventory: [],
				zoneId: zone.id,
				log: [],
				nextId: 1,
				rngState: 1,
			},
			world: { zones: { [zone.id]: zone }, tick: 0 },
		},
		IDLE,
		16,
	);
	expect(g.player.avatar.hp).toBe(before - SHOOTER.projDamage);
	expect(g.player.avatar.hurtT).toBeGreaterThan(0);
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(0); // consumed on hit
});

// player adjacent to a low-hp Field monster bound to spawn point 0, so killing
// it exercises the spawn-point → respawn machinery.
function fieldSpawnGame(monsterHp: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const spawn = { type: 'chaser' as const, x: 20 + BOX.w, y };
	const m = spawnMonster('chaser', 2, spawn.x, spawn.y, 0);
	m.hp = monsterHp; // killable; maxHp stays at the chaser baseline
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [m],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [spawn],
		respawns: [],
		portals: [],
		nextMonsterId: 3,
	};
	const player: PlayerState = {
		avatar: spawnAvatar(20, y),
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		zoneId: zone.id,
		log: [],
		nextId: 1,
		rngState: 1,
	};
	return { player, world: { zones: { [zone.id]: zone }, tick: 0 } };
}

const ATTACK: Input = { moveX: 0, jump: false, attack: true };

test('the authored Field seeds Monsters from its fixed spawn points', () => {
	const zone = activeZone(createGame().world, 'field-01');
	expect(zone.spawns.length).toBe(zone.monsters.length);
	expect(zone.monsters.every((m, i) => m.spawnIndex === i)).toBe(true);
	expect(zone.respawns.length).toBe(0);
});

test('killing a Field monster schedules a respawn at its spawn point', () => {
	const g = step(fieldSpawnGame(4), ATTACK, 16);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.monsters.length).toBe(0);
	expect(zone.respawns.length).toBe(1);
	expect(zone.respawns[0].spawnIndex).toBe(0);
});

test('a scheduled respawn restores the monster at full HP at its spawn point', () => {
	let g = step(fieldSpawnGame(4), ATTACK, 16);
	expect(activeZone(g.world, g.player.zoneId).monsters.length).toBe(0);
	let respawned = false;
	for (let i = 0; i < 300 && !respawned; i++) {
		g = step(g, IDLE, 50);
		const zone = activeZone(g.world, g.player.zoneId);
		if (zone.monsters.length === 1) {
			respawned = true;
			const m = zone.monsters[0];
			expect(m.hp).toBe(MONSTER.chaserHp);
			expect(m.hp).toBe(m.maxHp);
			expect(m.x).toBe(20 + BOX.w); // at the spawn point
			expect(m.y).toBe(GROUND_TOP - BOX.h);
			expect(m.spawnIndex).toBe(0);
			expect(zone.respawns.length).toBe(0);
		}
	}
	expect(respawned).toBe(true);
});

test('respawn scheduling + timing is deterministic', () => {
	let a = step(fieldSpawnGame(4), ATTACK, 16);
	let b = step(fieldSpawnGame(4), ATTACK, 16);
	for (let i = 0; i < 300; i++) {
		a = step(a, IDLE, 50);
		b = step(b, IDLE, 50);
	}
	const za = activeZone(a.world, a.player.zoneId);
	const zb = activeZone(b.world, b.player.zoneId);
	expect(zb.monsters.length).toBe(za.monsters.length);
	expect(zb.monsters[0]?.x).toBe(za.monsters[0]?.x);
	expect(zb.respawns.length).toBe(za.respawns.length);
});

test("only the active Zone ticks; the Avatar's persistent state lives above it", () => {
	// a second, dormant Field the Player is not in
	const dormant: Zone = {
		id: 'field-02',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [spawnMonster('chaser', 99, 60, GROUND_TOP - BOX.h)],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 100,
	};
	let g = createGame();
	g = {
		player: g.player,
		world: {
			zones: { ...g.world.zones, [dormant.id]: dormant },
			tick: g.world.tick,
		},
	};
	const before = g.world.zones['field-02'];
	g = step(g, { moveX: 1, jump: false, attack: false }, 16);
	// dormant Zone untouched (same reference)
	expect(g.world.zones['field-02']).toBe(before);
	expect(g.player.zoneId).toBe('town-01');
});
