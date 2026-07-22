import { expect, test } from 'bun:test';
import {
	DEFAULT_WEAPON,
	GROUND_POUND,
	POWER_STRIKE,
	skillForSlot,
	skillHitbox,
	skillsUnlockedBetween,
	skillUnlocked,
	weaponById,
} from '../../src/combat';
import type { Entity, Input } from '../../src/entities';
import {
	ARCHETYPES,
	BOX,
	DEFAULT_COSMETICS,
	spawnAvatar,
	spawnMonster,
} from '../../src/entities';
import { CAPABILITY_UNLOCK } from '../../src/progression';
import {
	type AvatarIntent,
	GROUND_TOP,
	type ServerAvatar,
	stepZone,
	type ZoneState,
} from '../../src/zones';
import { flatTerrain } from '../helpers';

const y = GROUND_TOP - BOX.h;

function skillState(level: number, monsters: Entity[]): ZoneState {
	const sa: ServerAvatar = {
		sessionId: 1,
		handle: 'hero',
		cosmetics: DEFAULT_COSMETICS,
		avatar: { ...spawnAvatar(20, y), id: 1 },
		progress: { level, xp: 0, gold: 0 },
		inventory: [],
		log: [],
		nextId: 1,
		rngState: 1,
		class: 'warrior',
		skillCooldowns: {},
	};
	return {
		zone: {
			id: 'test-zone',
			type: 'field',
			terrain: flatTerrain(),
			monsters,
			projectiles: [],
			nextProjectileId: 1,
			spawns: [],
			respawns: [],
			portals: [],
			nextMonsterId: 100,
		},
		avatars: [sa],
		tick: 0,
	};
}

function skillGame(level: number): ZoneState {
	return skillState(level, [spawnMonster('chaser', 2, 20 + BOX.w, y)]);
}

function flankedGame(level: number): ZoneState {
	return skillState(level, [
		spawnMonster('chaser', 2, 20 + BOX.w, y),
		spawnMonster('chaser', 3, 20 - BOX.w, y),
	]);
}

function intent(zs: ZoneState, input: Input): AvatarIntent {
	const a = zs.avatars[0].avatar;
	return {
		sessionId: 1,
		x: a.x,
		y: a.y,
		vx: 0,
		vy: 0,
		facing: a.facing,
		onGround: true,
		attack: input.attack,
		skill: input.skill,
	};
}

function step(zs: ZoneState, input: Input, dtMs: number): ZoneState {
	return stepZone(zs, [intent(zs, input)], dtMs);
}

const IDLE: Input = { moveX: 0, jump: false, attack: false };
const POWER: Input = { moveX: 0, jump: false, attack: false, skill: 1 };
const POUND: Input = { moveX: 0, jump: false, attack: false, skill: 2 };

test('Active skills use their capability-ladder unlock levels', () => {
	expect(POWER_STRIKE.unlockLevel).toBe(CAPABILITY_UNLOCK['power-strike']);
	expect(GROUND_POUND.unlockLevel).toBe(CAPABILITY_UNLOCK['ground-pound']);
	expect(POWER_STRIKE.unlockLevel).toBeLessThan(GROUND_POUND.unlockLevel);
});

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

test('skillsUnlockedBetween surfaces only the rung(s) a level-up crossed', () => {
	expect(
		skillsUnlockedBetween(
			'warrior',
			POWER_STRIKE.unlockLevel - 1,
			POWER_STRIKE.unlockLevel,
		),
	).toEqual([POWER_STRIKE]);
	expect(
		skillsUnlockedBetween(
			'warrior',
			GROUND_POUND.unlockLevel - 1,
			GROUND_POUND.unlockLevel,
		),
	).toEqual([GROUND_POUND]);
});

test('skillsUnlockedBetween lists every rung crossed on a multi-level jump, in ladder order', () => {
	expect(
		skillsUnlockedBetween(
			'warrior',
			POWER_STRIKE.unlockLevel - 1,
			GROUND_POUND.unlockLevel,
		),
	).toEqual([POWER_STRIKE, GROUND_POUND]);
});

test('skillsUnlockedBetween is empty when no configured rung is crossed', () => {
	expect(
		skillsUnlockedBetween(
			'warrior',
			GROUND_POUND.unlockLevel,
			GROUND_POUND.unlockLevel,
		),
	).toEqual([]);
	expect(
		skillsUnlockedBetween(
			'warrior',
			GROUND_POUND.unlockLevel,
			GROUND_POUND.unlockLevel + 1,
		),
	).toEqual([]);
});

test('skillUnlocked gates on the unlock level', () => {
	expect(skillUnlocked(POWER_STRIKE, POWER_STRIKE.unlockLevel - 1)).toBe(false);
	expect(skillUnlocked(POWER_STRIKE, POWER_STRIKE.unlockLevel)).toBe(true);
});

test('skillHitbox is a forgiving frontal arc widened by the skill reach', () => {
	const e = spawnAvatar(20, GROUND_TOP - BOX.h);
	const hb = skillHitbox(e, POWER_STRIKE);
	expect(hb.x).toBe(e.x + BOX.w);
	expect(hb.w).toBe(POWER_STRIKE.reach);
	expect(POWER_STRIKE.reach).toBeGreaterThan(BOX.w);
});

test('Ground Pound hitbox is centred on the Avatar, reaching equally to both sides', () => {
	const e = spawnAvatar(20, GROUND_TOP - BOX.h);
	const hb = skillHitbox(e, GROUND_POUND);
	expect(hb.x).toBe(e.x - GROUND_POUND.reach);
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
	expect(g.zone.monsters[0].hp).toBe(ARCHETYPES.chaser.hp);
	expect(g.avatars[0].skillCooldowns?.[POWER_STRIKE.id]).toBeUndefined();
});

test('Power Strike fires at its unlock level, hitting harder than a basic swing', () => {
	const g = step(skillGame(POWER_STRIKE.unlockLevel), POWER, 16);
	expect(g.zone.monsters[0].hp).toBe(
		ARCHETYPES.chaser.hp - POWER_STRIKE.damage,
	);
	expect(POWER_STRIKE.damage).toBeGreaterThan(
		weaponById(DEFAULT_WEAPON).damage,
	);
	expect(g.avatars[0].skillCooldowns?.[POWER_STRIKE.id]).toBe(
		POWER_STRIKE.cooldown,
	);
});

test('Power Strike cannot re-fire while on cooldown', () => {
	let g = step(skillGame(POWER_STRIKE.unlockLevel), POWER, 16);
	g = step(g, POWER, 16);
	const cd = g.avatars[0].skillCooldowns?.[POWER_STRIKE.id] ?? 0;
	expect(cd).toBeGreaterThan(0);
	expect(cd).toBeLessThan(POWER_STRIKE.cooldown);
});

test('Power Strike re-fires once its cooldown elapses', () => {
	let g = step(skillGame(POWER_STRIKE.unlockLevel), POWER, 16);

	const stepMs = 50;
	const cooldownTicks = Math.ceil((POWER_STRIKE.cooldown * 1000) / stepMs);
	for (let i = 0; i <= cooldownTicks; i++) g = step(g, IDLE, stepMs);
	expect(g.avatars[0].skillCooldowns?.[POWER_STRIKE.id] ?? 0).toBe(0);
	g = step(g, POWER, 16);
	expect(g.avatars[0].skillCooldowns?.[POWER_STRIKE.id]).toBe(
		POWER_STRIKE.cooldown,
	);
});

test('Ground Pound is locked below its unlock level — no effect, no cooldown', () => {
	const g = step(flankedGame(GROUND_POUND.unlockLevel - 1), POUND, 16);
	const ms = g.zone.monsters;
	expect(ms[0].hp).toBe(ARCHETYPES.chaser.hp);
	expect(ms[1].hp).toBe(ARCHETYPES.chaser.hp);
	expect(g.avatars[0].skillCooldowns?.[GROUND_POUND.id]).toBeUndefined();
});

test('Ground Pound damages monsters on BOTH sides of the Avatar at once', () => {
	const before = flankedGame(GROUND_POUND.unlockLevel);
	const g = step(before, POUND, 16);
	for (const monster of before.zone.monsters) {
		const remaining = g.zone.monsters.find(
			(candidate) => candidate.id === monster.id,
		);
		expect(remaining?.hp ?? 0).toBe(
			Math.max(0, monster.hp - GROUND_POUND.damage),
		);
	}
	expect(g.avatars[0].skillCooldowns?.[GROUND_POUND.id]).toBe(
		GROUND_POUND.cooldown,
	);
});

test('a frontal skill leaves the monster behind the Avatar untouched (contrast)', () => {
	const g = step(flankedGame(POWER_STRIKE.unlockLevel), POWER, 16);
	const back = g.zone.monsters.find((m) => m.id === 3);
	expect(back?.hp).toBe(ARCHETYPES.chaser.hp);
});

test('Ground Pound cannot re-fire while on cooldown', () => {
	let g = step(flankedGame(GROUND_POUND.unlockLevel), POUND, 16);
	g = step(g, POUND, 16);
	const cd = g.avatars[0].skillCooldowns?.[GROUND_POUND.id] ?? 0;
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
	expect(b.zone.monsters[0]?.hp).toBe(a.zone.monsters[0]?.hp);
	expect(b.avatars[0].skillCooldowns?.[POWER_STRIKE.id]).toBe(
		a.avatars[0].skillCooldowns?.[POWER_STRIKE.id],
	);
});
