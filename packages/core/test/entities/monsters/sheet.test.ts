import { expect, test } from 'bun:test';
import type {
	AttackPhaseTimings,
	BrainView,
	Entity,
	MonsterSpec,
	MonsterStats,
	MonsterType,
} from '../../../src/entities';
import { MONSTERS, spawnMonster } from '../../../src/entities';
import {
	defineMonster,
	fireEngine,
	hopEngine,
	pounceEngine,
	swingEngine,
	walkEngine,
} from '../../../src/entities/monsters';
import { DEFAULT_MASS } from '../../../src/physics/constants';
import { flatTerrain, SPAWN_Y } from '../../helpers';

const flat = flatTerrain();
const view = (targetX: number | null): BrainView => ({
	terrain: flat,
	targetX,
});

function grounded(type: MonsterType, x: number): Entity {
	const m = spawnMonster(type, 2, x, SPAWN_Y);
	m.onGround = true;
	return m;
}

/** The QA-approved character sheets, pinned number by number. */
const SHEETS: Record<MonsterType, MonsterStats> = {
	slime: {
		hp: 24,
		speed: 12,
		mass: 0.85,
		damage: 8,
		vision: 22,
		range: 12,
	},
	chaser: {
		hp: 32,
		speed: 13,
		mass: DEFAULT_MASS,
		damage: 11,
		vision: 22,
		range: 4,
	},
	brute: {
		hp: 60,
		speed: 6,
		mass: 4,
		poise: 48,
		damage: 18,
		vision: 26,
		range: 5,
	},
	shooter: {
		hp: 16,
		speed: 9,
		mass: DEFAULT_MASS,
		damage: 7,
		vision: 46,
		range: 20,
	},
};

test('every monster carries its character sheet, exhaustively keyed by type', () => {
	for (const type of Object.keys(SHEETS) as MonsterType[])
		expect(MONSTERS[type].stats).toEqual(SHEETS[type]);
});

test('stats flow into the engines: range is the swing commit threshold', () => {
	const stats = { ...SHEETS.chaser, range: 9 };
	const spec = defineMonster({
		stats,
		movement: walkEngine(),
		combat: swingEngine(),
	});
	const m = grounded('chaser', 50);
	expect(spec.brain(m, view(m.x - 9)).drive.commit).toBe('swing');
	expect(spec.brain(m, view(m.x - 9.01)).drive.commit).toBeUndefined();
});

test('range survives the monster swapping combat engines', () => {
	const stats = { ...SHEETS.chaser, range: 9 };
	const pouncer = defineMonster({
		stats,
		movement: walkEngine(),
		combat: pounceEngine(),
	});
	const m = grounded('chaser', 50);
	expect(pouncer.brain(m, view(m.x - 9)).drive.commit).toBe('pounce');
	expect(pouncer.brain(m, view(m.x - 9.01)).drive.commit).toBeUndefined();
});

test('vision survives the monster swapping movement engines', () => {
	const stats = { ...SHEETS.chaser, vision: 15 };
	for (const movement of [walkEngine(), hopEngine()]) {
		const spec = defineMonster({ stats, movement, combat: swingEngine() });
		const m = grounded('chaser', 50);
		expect(spec.brain(m, view(m.x - 14.99)).ai.state).toBe('combat');
		expect(spec.brain(m, view(m.x - 15)).ai.state).toBe('patrol');
	}
});

test('damage survives the monster swapping combat engines', () => {
	const stats = { ...SHEETS.chaser, damage: 42 };
	const swinger = defineMonster({
		stats,
		movement: walkEngine(),
		combat: swingEngine(),
	});
	const pouncer = defineMonster({
		stats,
		movement: walkEngine(),
		combat: pounceEngine(),
	});
	const ctx = { attackTBefore: 1, nextProjectileId: 1 };
	for (const spec of [swinger, pouncer]) {
		const m = grounded('chaser', 50);
		m.onGround = false;
		m.attackT = activeT(spec.combat.timings);
		expect(spec.combat.project?.(m, ctx)?.strikes?.[0]?.damage).toBe(42);
	}
});

/** A timer sitting squarely inside an attack's active window. */
const activeT = (t: AttackPhaseTimings) => t.recovery + t.active / 2;

/** A stock engine, given the founding monster's stats, must reproduce it. */
const probe = (type: MonsterType) => {
	const ctx = { attackTBefore: 1, nextProjectileId: 1 };
	return (spec: MonsterSpec) => {
		const m = grounded(type, 50);
		m.facing = -1;
		m.onGround = false;
		m.attackT = activeT(spec.combat.timings);
		return {
			timings: spec.combat.timings,
			swat: spec.combat.swat ?? null,
			commit: spec.combat.commit?.(m) ?? null,
			committedDrive: spec.combat.committedDrive?.(m) ?? null,
			afterStep: spec.combat.afterStep?.(m) ?? null,
			projection: spec.combat.project?.(m, ctx) ?? null,
		};
	};
};

test('stock walk + swing reproduce the chaser, their founding monster', () => {
	const stock = defineMonster({
		stats: MONSTERS.chaser.stats,
		movement: walkEngine(),
		combat: swingEngine(),
	});
	const read = probe('chaser');
	expect(read(stock)).toEqual(read(MONSTERS.chaser));
});

test('stock hop + pounce reproduce the slime, their founding monster', () => {
	const stock = defineMonster({
		stats: MONSTERS.slime.stats,
		movement: hopEngine(),
		combat: pounceEngine(),
	});
	const read = probe('slime');
	expect(read(stock)).toEqual(read(MONSTERS.slime));
});

test('stock fire reproduces the shooter, its founding monster', () => {
	const stock = defineMonster({
		stats: MONSTERS.shooter.stats,
		movement: walkEngine({ deadzone: 0 }),
		combat: fireEngine(),
	});
	const read = probe('shooter');
	expect(read(stock)).toEqual(read(MONSTERS.shooter));
});
