// Field respawn scheduling at the zone-tick seam (moved from the old
// single-player runtime's coverage when sim.ts died).
import { expect, test } from 'bun:test';
import { COMBAT, SWING_TOTAL } from '../../src/combat';
import type { SpawnPoint } from '../../src/entities';
import {
	ARCHETYPES,
	BOX,
	DEFAULT_COSMETICS,
	spawnAvatar,
	spawnMonster,
} from '../../src/entities';
import {
	type AvatarIntent,
	GROUND_TOP,
	type ServerAvatar,
	stepZone,
	type ZoneState,
} from '../../src/zones';
import { flatTerrain } from '../helpers';

const y = GROUND_TOP - BOX.h;

// Prime a swing mid-active so a connect lands this tick (hitbox is active-only).
const MID_ACTIVE = SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;

function fieldSpawnState(monsterHp: number): ZoneState {
	const spawn: SpawnPoint = { type: 'chaser', x: 20 + BOX.w, y };
	const m = spawnMonster('chaser', 2, spawn.x, spawn.y, 0);
	m.hp = monsterHp;
	const sa: ServerAvatar = {
		sessionId: 1,
		handle: 'hero',
		cosmetics: DEFAULT_COSMETICS,
		avatar: { ...spawnAvatar(20, y), id: 1, attackT: MID_ACTIVE },
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: [],
		nextId: 1,
		rngState: 1,
	};
	return {
		zone: {
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
		},
		avatars: [sa],
		tick: 0,
	};
}

function holdAt(zs: ZoneState, attack: boolean): AvatarIntent {
	const a = zs.avatars[0].avatar;
	return {
		sessionId: 1,
		x: a.x,
		y: a.y,
		vx: 0,
		vy: 0,
		facing: a.facing,
		onGround: true,
		attack,
	};
}

test('killing a Field monster schedules a respawn at its spawn point', () => {
	const zs = fieldSpawnState(4);
	const next = stepZone(zs, [holdAt(zs, true)], 16);
	expect(next.zone.monsters.length).toBe(0);
	expect(next.zone.respawns.length).toBe(1);
	expect(next.zone.respawns[0].spawnIndex).toBe(0);
});

test('a scheduled respawn restores the monster at full HP at its spawn point', () => {
	let zs = stepZone(fieldSpawnState(4), [holdAt(fieldSpawnState(4), true)], 16);
	expect(zs.zone.monsters.length).toBe(0);
	let respawned = false;
	for (let i = 0; i < 300 && !respawned; i++) {
		zs = stepZone(zs, [holdAt(zs, false)], 50);
		if (zs.zone.monsters.length === 1) {
			respawned = true;
			const m = zs.zone.monsters[0];
			expect(m.hp).toBe(ARCHETYPES.chaser.hp);
			expect(m.hp).toBe(m.maxHp);
			expect(m.x).toBe(20 + BOX.w);
			expect(m.y).toBe(y);
			expect(m.spawnIndex).toBe(0);
			expect(zs.zone.respawns.length).toBe(0);
		}
	}
	expect(respawned).toBe(true);
});

test('respawn scheduling + timing is deterministic', () => {
	const run = () => {
		let zs = stepZone(
			fieldSpawnState(4),
			[holdAt(fieldSpawnState(4), true)],
			16,
		);
		for (let i = 0; i < 300; i++) zs = stepZone(zs, [holdAt(zs, false)], 50);
		return zs;
	};
	const a = run();
	const b = run();
	expect(b.zone.monsters.length).toBe(a.zone.monsters.length);
	expect(b.zone.monsters[0]?.x).toBe(a.zone.monsters[0]?.x);
	expect(b.zone.respawns.length).toBe(a.zone.respawns.length);
});
