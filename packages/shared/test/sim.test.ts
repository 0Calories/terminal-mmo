import { expect, test } from 'bun:test';
import type { GameState, Input, PlayerState, Projectile, Zone } from '../src';
import {
	activeZone,
	BOX,
	createGame,
	GROUND_TOP,
	MONSTER,
	makeStarterField,
	SHOOTER,
	spawnAvatar,
	spawnMonster,
	step,
	XP_PER_KILL,
} from '../src';

const IDLE: Input = { moveX: 0, jump: false, attack: false };

test('createGame separates Player state from the World of Zones', () => {
	const g = createGame();
	expect(g.world.tick).toBe(0);
	expect(g.player.avatar.type).toBe('player');
	expect(g.player.zoneId in g.world.zones).toBe(true);
	const zone = activeZone(g.world, g.player.zoneId);
	expect(zone.type).toBe('field');
	expect(zone.monsters.length).toBe(8);
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
		terrain: makeStarterField(),
		monsters: [m],
		projectiles: [],
		nextProjectileId: 1,
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

// player at x=40, one shooter `gap` cells to the right on flat ground.
function shooterGame(gap: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const m = spawnMonster('shooter', 2, 40 + gap, y);
	m.onGround = true;
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: makeStarterField(),
		monsters: [m],
		projectiles: [],
		nextProjectileId: 1,
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
	let g = step(shooterGame(30), IDLE, 16); // first shot
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
		terrain: makeStarterField(),
		monsters: [],
		projectiles: [proj],
		nextProjectileId: 2,
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
	// the projectile is consumed on hit
	expect(activeZone(g.world, g.player.zoneId).projectiles.length).toBe(0);
});

test("only the active Zone ticks; the Avatar's persistent state lives above it", () => {
	// a second, dormant Field the Player is not in
	const dormant: Zone = {
		id: 'field-02',
		type: 'field',
		terrain: makeStarterField(),
		monsters: [spawnMonster('chaser', 99, 60, GROUND_TOP - BOX.h)],
		projectiles: [],
		nextProjectileId: 1,
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
	// dormant Zone untouched (same reference), active Zone advanced
	expect(g.world.zones['field-02']).toBe(before);
	expect(g.player.zoneId).toBe('field-01');
});
