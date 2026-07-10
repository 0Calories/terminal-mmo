import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import type { GameState, Input, PlayerState, Projectile, Zone } from '../src';
import {
	activeZone,
	BOX,
	CAPABILITY_UNLOCK,
	COMBAT,
	createGameFromZones,
	GROUND_TOP,
	MONSTER,
	SHOOTER,
	SWING_TOTAL,
	spawnAvatar,
	spawnMonster,
	step,
	xpForKill,
} from '../src';
import { createGame, flatTerrain, makeProjectile } from './helpers';

const IDLE: Input = { moveX: 0, jump: false, attack: false };

// Prime a swing mid-active so one attacking step lands the hit (hitbox is active-only).
const MID_ACTIVE = SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
function primeSwing(g: GameState): GameState {
	g.player.avatar.attackT = MID_ACTIVE;
	return g;
}

test('createGame separates Player state from the World of Zones', () => {
	const g = createGame();
	expect(g.world.tick).toBe(0);
	expect(g.player.avatar.type).toBe('player');
	expect(g.player.zoneId in g.world.zones).toBe(true);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.type).toBe('town');
	expect(zone.monsters.length).toBe(0);
});

test('createGameFromZones seeds the sim from an explicit Zone set + start id', () => {
	const zones = loadZones();
	const field = zones.find((z) => z.type === 'field');
	if (!field) throw new Error('expected an authored field Zone');
	const g = createGameFromZones(zones, field.id);
	expect(g.player.zoneId).toBe(field.id);
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

function adjacentGame(monsterHp?: number, id = 'field-01'): GameState {
	const y = GROUND_TOP - BOX.h;
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	if (monsterHp !== undefined) {
		m.hp = monsterHp;
		m.maxHp = monsterHp;
	}
	const zone: Zone = {
		id,
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
	const g = step(
		primeSwing(adjacentGame()),
		{ moveX: 0, jump: false, attack: true },
		16,
	);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.monsters[0].hp).toBe(MONSTER.chaserHp - 8);
});

test('step surfaces the tick CombatEvents so the offline loop can feed the particle system', () => {
	const game = primeSwing(adjacentGame());
	game.player.avatar.hurtT = 1; // i-framed, so the chaser's contact draws no blood
	const g = step(game, { moveX: 0, jump: false, attack: true }, 16);
	expect(g.events?.length).toBe(1);
	expect(g.events?.[0].kind).toBe('hit');
});

test('a step with no combat surfaces no CombatEvents', () => {
	const game = adjacentGame();
	game.player.avatar.hurtT = 1; // i-framed, so the chaser's contact draws no blood
	const g = step(game, IDLE, 16);
	expect(g.events ?? []).toEqual([]);
});

test('killing a monster grants XP and, standing on the kill, collects its instanced loot Drop', () => {
	// Every Dungeon kill drops; standing on the kill collects the private Drop that tick.
	const g = step(
		primeSwing(adjacentGame(4, 'dungeon-01')),
		{ moveX: 0, jump: false, attack: true },
		16,
	);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.monsters.length).toBe(0);
	expect(g.player.inventory.length).toBe(1);
	expect(g.player.progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	expect(g.player.inventory[0].id).toBe(1);
	expect(zone.drops ?? []).toEqual([]);
});

// A chaser stacked on the Avatar's x, where naive homing would flip-flop each frame.
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
	expect(start.x).toBe(40);
	for (let i = 0; i < 30; i++) {
		g = step(g, IDLE, 16);
		const m = activeZone(g.world, g.player.zoneId).monsters[0];
		expect(m.x).toBe(40);
		expect(m.facing).toBe(1);
	}
});

test('a chaser outside the deadzone still closes in on the Avatar', () => {
	const g = step(adjacentGame(), IDLE, 16);
	const m = activeZone(g.world, g.player.zoneId).monsters[0];
	expect(m.x).toBeLessThan(20 + BOX.w);
});

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

test('a ranged poker telegraphs a swing before firing — no shot on the commit tick', () => {
	let g = step(shooterGame(30), IDLE, 16);
	expect(
		activeZone(g.world, g.player.zoneId).monsters[0].attackT,
	).toBeGreaterThan(0);
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(0);
	let fired = 0;
	for (let i = 0; i < 12 && fired === 0; i++) {
		g = step(g, IDLE, 16);
		fired = activeZone(g.world, g.player.zoneId).projectiles.length;
	}
	expect(fired).toBe(1);
});

test('a ranged poker does not auto-fire a second shot during its cooldown', () => {
	let g = shooterGame(30);
	let fired = 0;
	for (let i = 0; i < 12 && fired === 0; i++) {
		g = step(g, IDLE, 16);
		fired = activeZone(g.world, g.player.zoneId).projectiles.length;
	}
	expect(fired).toBe(1);
	const idAfterFirst = activeZone(g.world, g.player.zoneId).projectiles[0]?.id;
	let extraFired = false;
	for (let i = 0; i < 6; i++) {
		g = step(g, IDLE, 16);
		const ps = activeZone(g.world, g.player.zoneId).projectiles;
		if (ps.some((p) => p.id !== idAfterFirst)) extraFired = true;
	}
	expect(extraFired).toBe(false);
});

test('a shooter does not fire when the Avatar is out of range', () => {
	const g = step(shooterGame(SHOOTER.aggro + 10), IDLE, 16);
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(0);
});

test('a shooter backs away when the Avatar gets too close', () => {
	const g = step(shooterGame(SHOOTER.keepDist - 5), IDLE, 16);
	const m = activeZone(g.world, g.player.zoneId).monsters[0];
	// shooter started right of the Avatar, so retreating means moving further right
	expect(m.x).toBeGreaterThan(40 + SHOOTER.keepDist - 5);
});

test('a projectile overlapping the Avatar damages it and applies i-frames', () => {
	const y = GROUND_TOP - BOX.h;
	const avatar = spawnAvatar(40, y);
	const proj: Projectile = makeProjectile({
		x: avatar.x + 1,
		y: avatar.y + 1,
	});
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
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(0);
});

function fieldSpawnGame(monsterHp: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const spawn = { type: 'chaser' as const, x: 20 + BOX.w, y };
	const m = spawnMonster('chaser', 2, spawn.x, spawn.y, 0);
	m.hp = monsterHp;
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
		avatar: { ...spawnAvatar(20, y), attackT: MID_ACTIVE },
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
			expect(m.x).toBe(20 + BOX.w);
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
	expect(g.world.zones['field-02']).toBe(before);
	expect(g.player.zoneId).toBe('town-01');
});

test('a Dodge hops in the held direction via a momentum-body impulse', () => {
	let g = createGame();
	g.player.avatar.onGround = true;
	g.player.progress.level = CAPABILITY_UNLOCK.dodge;
	const x0 = g.player.avatar.x;
	g = step(g, { moveX: 1, jump: false, attack: false, dodge: true }, 16);
	expect(g.player.avatar.dodgeT ?? 0).toBeGreaterThan(0);
	expect(g.player.avatar.ivx ?? 0).toBeGreaterThan(0);
	expect(g.player.avatar.x).toBeGreaterThan(x0);
});

test('the hop follows the held direction (left)', () => {
	let g = createGame();
	g.player.avatar.onGround = true;
	g.player.progress.level = CAPABILITY_UNLOCK.dodge;
	g = step(g, { moveX: -1, jump: false, attack: false, dodge: true }, 16);
	expect(g.player.avatar.ivx ?? 0).toBeLessThan(0);
});

test('a standstill dodge does nothing — a direction must be held', () => {
	let g = createGame();
	g.player.avatar.onGround = true;
	g.player.progress.level = CAPABILITY_UNLOCK.dodge;
	g = step(g, { moveX: 0, jump: false, attack: false, dodge: true }, 16);
	expect(g.player.avatar.dodgeT ?? 0).toBe(0);
	expect(g.player.avatar.ivx ?? 0).toBe(0);
});

test('a Dodge cannot be re-triggered mid-hop (committal)', () => {
	let g = createGame();
	g.player.avatar.onGround = true;
	g.player.progress.level = CAPABILITY_UNLOCK.dodge;
	g = step(g, { moveX: 1, jump: false, attack: false, dodge: true }, 16);
	const ivxAfterStart = g.player.avatar.ivx ?? 0;
	g = step(g, { moveX: 1, jump: false, attack: false, dodge: true }, 16);
	expect(g.player.avatar.ivx ?? 0).toBeLessThan(ivxAfterStart);
	expect(g.player.avatar.ivx ?? 0).toBeGreaterThan(0);
});
