import { expect, test } from 'bun:test';
import type { GameState, Input, PlayerState, Zone } from '../src';
import {
	activeZone,
	BOX,
	GROUND_POUND,
	GROUND_TOP,
	MONSTER,
	POWER_STRIKE,
	skillForSlot,
	skillHitbox,
	skillUnlocked,
	spawnAvatar,
	spawnMonster,
	step,
} from '../src';
import { flatTerrain } from './helpers';

// Player at x=20 facing right, one chaser directly in front on flat ground.
function skillGame(level: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
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
		progress: { level, xp: 0, gold: 0 },
		inventory: [],
		zoneId: zone.id,
		log: [],
		nextId: 1,
		rngState: 1,
		class: 'warrior',
		skillCooldowns: {},
	};
	return { player, world: { zones: { [zone.id]: zone }, tick: 0 } };
}

// Player at x=20 facing right, flanked by a chaser on each side, both within the
// AoE reach. Lets a both-sides Ground Pound be observed hitting front AND back.
function flankedGame(level: number): GameState {
	const y = GROUND_TOP - BOX.h;
	const front = spawnMonster('chaser', 2, 20 + BOX.w, y); // body to the right
	const back = spawnMonster('chaser', 3, 20 - BOX.w, y); // body to the left
	const zone: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [front, back],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 4,
	};
	const player: PlayerState = {
		avatar: spawnAvatar(20, y),
		progress: { level, xp: 0, gold: 0 },
		inventory: [],
		zoneId: zone.id,
		log: [],
		nextId: 1,
		rngState: 1,
		class: 'warrior',
		skillCooldowns: {},
	};
	return { player, world: { zones: { [zone.id]: zone }, tick: 0 } };
}

const IDLE: Input = { moveX: 0, jump: false, attack: false };
const POWER: Input = { moveX: 0, jump: false, attack: false, skill: 1 };
const POUND: Input = { moveX: 0, jump: false, attack: false, skill: 2 };

test('skillForSlot binds Warrior slot 1 to Power Strike, slot 2 to Ground Pound; empty slots are undefined', () => {
	expect(skillForSlot('warrior', 1)).toBe(POWER_STRIKE);
	expect(skillForSlot('warrior', 2)).toBe(GROUND_POUND);
	expect(skillForSlot('warrior', 3)).toBeUndefined();
});

test('Ground Pound is an AoE Warrior skill with an unlock level and a cooldown', () => {
	expect(GROUND_POUND.kind).toBe('aoe');
	expect(GROUND_POUND.unlockLevel).toBeGreaterThan(1);
	expect(GROUND_POUND.cooldown).toBeGreaterThan(0);
	expect(GROUND_POUND.damage).toBeGreaterThan(0);
});

test('skillUnlocked gates on the unlock level', () => {
	expect(skillUnlocked(POWER_STRIKE, POWER_STRIKE.unlockLevel - 1)).toBe(false);
	expect(skillUnlocked(POWER_STRIKE, POWER_STRIKE.unlockLevel)).toBe(true);
});

test('skillHitbox is a forgiving frontal arc widened by the skill reach', () => {
	const e = spawnAvatar(20, GROUND_TOP - BOX.h);
	const hb = skillHitbox(e, POWER_STRIKE);
	expect(hb.x).toBe(e.x + BOX.w); // in front, facing right
	expect(hb.w).toBe(POWER_STRIKE.reach);
	expect(POWER_STRIKE.reach).toBeGreaterThan(BOX.w);
});

test('Ground Pound hitbox is centred on the Avatar, reaching equally to both sides', () => {
	const e = spawnAvatar(20, GROUND_TOP - BOX.h);
	const hb = skillHitbox(e, GROUND_POUND);
	// reaches GROUND_POUND.reach to the left of the body...
	expect(hb.x).toBe(e.x - GROUND_POUND.reach);
	// ...and the same distance past the right edge of the body (symmetric)
	expect(hb.x + hb.w).toBe(e.x + BOX.w + GROUND_POUND.reach);
	expect(hb.w).toBe(BOX.w + 2 * GROUND_POUND.reach);
});

test('Ground Pound hitbox is the same regardless of which way the Avatar faces', () => {
	const right = spawnAvatar(20, GROUND_TOP - BOX.h);
	right.facing = 1;
	const left = spawnAvatar(20, GROUND_TOP - BOX.h);
	left.facing = -1;
	expect(skillHitbox(left, GROUND_POUND)).toEqual(
		skillHitbox(right, GROUND_POUND),
	);
});

test('Power Strike is locked below its unlock level — no effect, no cooldown', () => {
	const g = step(skillGame(POWER_STRIKE.unlockLevel - 1), POWER, 16);
	expect(activeZone(g.world, g.player.zoneId).monsters[0].hp).toBe(
		MONSTER.chaserHp,
	);
	expect(g.player.skillCooldowns?.[POWER_STRIKE.id]).toBeUndefined();
});

test('Power Strike fires at its unlock level, hitting harder than a basic swing', () => {
	const g = step(skillGame(POWER_STRIKE.unlockLevel), POWER, 16);
	expect(activeZone(g.world, g.player.zoneId).monsters[0].hp).toBe(
		MONSTER.chaserHp - POWER_STRIKE.damage,
	);
	expect(POWER_STRIKE.damage).toBeGreaterThan(8); // > basic melee
	expect(g.player.skillCooldowns?.[POWER_STRIKE.id]).toBe(
		POWER_STRIKE.cooldown,
	);
});

test('Power Strike cannot re-fire while on cooldown', () => {
	let g = step(skillGame(POWER_STRIKE.unlockLevel), POWER, 16);
	g = step(g, POWER, 16); // pressed again while on cooldown
	const cd = g.player.skillCooldowns?.[POWER_STRIKE.id] ?? 0;
	// cooldown ticked down rather than reset to full — proves it did not re-fire
	expect(cd).toBeGreaterThan(0);
	expect(cd).toBeLessThan(POWER_STRIKE.cooldown);
});

test('Power Strike re-fires once its cooldown elapses', () => {
	let g = step(skillGame(POWER_STRIKE.unlockLevel), POWER, 16);
	// idle long enough for the cooldown to expire (dt clamped to 0.05s/tick)
	for (let i = 0; i < 80; i++) g = step(g, IDLE, 50);
	expect(g.player.skillCooldowns?.[POWER_STRIKE.id] ?? 0).toBe(0);
	g = step(g, POWER, 16); // fires again → cooldown reset to full
	expect(g.player.skillCooldowns?.[POWER_STRIKE.id]).toBe(
		POWER_STRIKE.cooldown,
	);
});

test('Ground Pound is locked below its unlock level — no effect, no cooldown', () => {
	const g = step(flankedGame(GROUND_POUND.unlockLevel - 1), POUND, 16);
	const ms = activeZone(g.world, g.player.zoneId).monsters;
	expect(ms[0].hp).toBe(MONSTER.chaserHp);
	expect(ms[1].hp).toBe(MONSTER.chaserHp);
	expect(g.player.skillCooldowns?.[GROUND_POUND.id]).toBeUndefined();
});

test('Ground Pound damages monsters on BOTH sides of the Avatar at once', () => {
	const g = step(flankedGame(GROUND_POUND.unlockLevel), POUND, 16);
	// one pound clears both flanking chasers (front + back) — crowd control
	expect(activeZone(g.world, g.player.zoneId).monsters.length).toBe(0);
	expect(g.player.skillCooldowns?.[GROUND_POUND.id]).toBe(
		GROUND_POUND.cooldown,
	);
});

test('a frontal skill leaves the monster behind the Avatar untouched (contrast)', () => {
	// Power Strike at the same flanked layout — only the front chaser is hit, the
	// one behind keeps full HP, isolating Ground Pound's both-sides reach.
	const g = step(flankedGame(POWER_STRIKE.unlockLevel), POWER, 16);
	const back = activeZone(g.world, g.player.zoneId).monsters.find(
		(m) => m.id === 3,
	);
	expect(back?.hp).toBe(MONSTER.chaserHp);
});

test('Ground Pound cannot re-fire while on cooldown', () => {
	let g = step(flankedGame(GROUND_POUND.unlockLevel), POUND, 16);
	g = step(g, POUND, 16); // pressed again while on cooldown
	const cd = g.player.skillCooldowns?.[GROUND_POUND.id] ?? 0;
	expect(cd).toBeGreaterThan(0);
	expect(cd).toBeLessThan(GROUND_POUND.cooldown);
});

test('skill use is deterministic for identical inputs', () => {
	let a = skillGame(POWER_STRIKE.unlockLevel);
	let b = skillGame(POWER_STRIKE.unlockLevel);
	const seq = [POWER, IDLE, IDLE, POWER, IDLE];
	for (const input of seq) {
		a = step(a, input, 16);
		b = step(b, input, 16);
	}
	expect(activeZone(b.world, b.player.zoneId).monsters[0]?.hp).toBe(
		activeZone(a.world, a.player.zoneId).monsters[0]?.hp,
	);
	expect(b.player.skillCooldowns?.[POWER_STRIKE.id]).toBe(
		a.player.skillCooldowns?.[POWER_STRIKE.id],
	);
});
