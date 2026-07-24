import { expect, test } from 'bun:test';
import {
	attackTotal,
	entityBox,
	meleeKnockback,
} from '../../../../src/combat/combat';
import type { BrainView, Entity } from '../../../../src/entities';
import { ARCHETYPES, spawnMonster } from '../../../../src/entities';
import type {
	CombatContext,
	HopMemory,
	MovementEngine,
	Perception,
} from '../../../../src/entities/monsters';
import type { PounceShape } from '../../../../src/entities/monsters/slime';
import { pounceEngine } from '../../../../src/entities/monsters/slime';
import { flatTerrain, SPAWN_Y } from '../../../helpers';

const RANGE = 12;
const MELEE = ARCHETYPES.slime.melee;
const TIMINGS = MELEE.pounce;
if (!TIMINGS) throw new Error('the slime profile must author pounce timings');

const SHAPE: PounceShape = {
	range: RANGE,
	cooldown: MELEE.commitCd,
	timings: TIMINGS,
	leap: TIMINGS.leap,
	strike: {
		damage: MELEE.damage,
		poiseDamage: MELEE.poise,
		...meleeKnockback(MELEE),
	},
};
const pounce = pounceEngine(SHAPE);
const flat = flatTerrain();
const view: BrainView = { terrain: flat, targetX: null };

const TRAVEL_DRIVE = { moveX: -1, jump: true } as const;
const HOLD_DRIVE = { moveX: 0, jump: false } as const;

/** A gait that records the destinations it was asked to reach. */
function stubGait(travelling = true) {
	const destinations: number[] = [];
	const movement: MovementEngine = {
		wander: () => ({ drive: { ...HOLD_DRIVE } }),
		moveToward: (m, _v, destX) => {
			destinations.push(destX);
			return {
				drive:
					destX === m.x || !travelling
						? { ...HOLD_DRIVE }
						: { ...TRAVEL_DRIVE },
			};
		},
	};
	return { destinations, movement };
}

function grounded(x: number): Entity {
	const m = spawnMonster('slime', 2, x, SPAWN_Y);
	m.onGround = true;
	return m;
}

function context(
	monster: Entity,
	targetX: number,
	movement: MovementEngine,
): CombatContext {
	const dx = targetX - monster.x;
	const perception: Perception = {
		targetX,
		dx,
		adx: Math.abs(dx),
		inVision: true,
	};
	return { monster, view, perception, movement, memory: { state: 'combat' } };
}

test('the approach stops at the lip of pounce range', () => {
	const { destinations, movement } = stubGait();
	const m = grounded(50);
	const targetX = m.x - 30;
	const step = pounce.fight(context(m, targetX, movement));
	expect(step.drive.commit).toBeUndefined();
	expect(destinations).toEqual([targetX + (RANGE - 1)]);
	expect(step.drive.moveX).toBe(-1);
});

test('inside the lip the approach holds where it stands', () => {
	const { destinations, movement } = stubGait();
	const m = grounded(50);
	m.attackCdT = 1;
	pounce.fight(context(m, m.x - (RANGE - 2), movement));
	expect(destinations).toEqual([m.x]);
});

test('the commit comes from a standstill, squared up on the target', () => {
	const { movement } = stubGait();
	const m = grounded(50);
	const step = pounce.fight(context(m, m.x - RANGE, movement));
	expect(step.drive.commit).toBe('pounce');
	expect(step.drive.moveX).toBe(0);
	expect(step.drive.jump).toBe(false);
	expect(step.drive.face).toBe(-1);
});

test('a resting gait never gates the commit', () => {
	const { movement } = stubGait(false);
	const m = grounded(50);
	const step = pounce.fight(context(m, m.x - RANGE, movement));
	expect(step.drive.commit).toBe('pounce');
});

test('a step beyond leap range approaches instead of committing', () => {
	const { movement } = stubGait();
	const m = grounded(50);
	const step = pounce.fight(context(m, m.x - (RANGE + 0.01), movement));
	expect(step.drive.commit).toBeUndefined();
});

test('a cooling-down pounce closes in without committing', () => {
	const { movement } = stubGait();
	const m = grounded(50);
	m.attackCdT = 1;
	const step = pounce.fight(context(m, m.x - RANGE, movement));
	expect(step.drive.commit).toBeUndefined();
});

test('there is no commit in mid-air: the pounce leaps from the ground', () => {
	const { movement } = stubGait();
	const m = grounded(50);
	m.onGround = false;
	const step = pounce.fight(context(m, m.x - RANGE, movement));
	expect(step.drive.commit).toBeUndefined();
});

test('a travelling approach keeps its heading; only a standstill squares up', () => {
	const { movement } = stubGait();
	const m = grounded(50);
	const travelling = pounce.fight(context(m, m.x - 30, movement));
	expect(travelling.drive.face).toBeUndefined();

	const holding = pounce.fight(context(m, m.x - (RANGE - 2), movement));
	expect(holding.drive.face).toBe(-1);
});

test('the gait keeps its own memory: the pounce hands it back untouched', () => {
	const memory: HopMemory = { kind: 'hop', restT: 3, cadence: 'approach' };
	const movement: MovementEngine = {
		wander: () => ({ drive: { ...HOLD_DRIVE } }),
		moveToward: () => ({ drive: { ...HOLD_DRIVE }, memory }),
	};
	const m = grounded(50);
	expect(pounce.fight(context(m, m.x - RANGE, movement)).movement).toBe(memory);
});

const TOTAL = attackTotal(TIMINGS);

/** Attack timers that sit squarely inside each phase of a committed leap. */
const PHASE_T = {
	windup: TOTAL,
	active: TIMINGS.active / 2 + TIMINGS.recovery,
	recovery: TIMINGS.recovery / 2,
} as const;

function committed(phase: keyof typeof PHASE_T, onGround: boolean): Entity {
	const m = grounded(50);
	m.facing = -1;
	m.attackT = PHASE_T[phase];
	m.onGround = onGround;
	return m;
}

test('an uncommitted body is left to the Brain drive', () => {
	expect(pounce.committedDrive?.(grounded(50)) ?? null).toBeNull();
});

test('the wind-up and the wobble stand still', () => {
	expect(pounce.committedDrive?.(committed('windup', true))).toEqual({
		moveX: 0,
		jump: false,
	});
	expect(pounce.committedDrive?.(committed('recovery', true))).toEqual({
		moveX: 0,
		jump: false,
	});
});

test('the active leap launches from the ground then rides its locked arc', () => {
	expect(pounce.committedDrive?.(committed('active', true))).toEqual({
		moveX: -1,
		jump: true,
		moveScale: TIMINGS.leap.speed,
		jumpScale: TIMINGS.leap.jump,
	});
	expect(pounce.committedDrive?.(committed('active', false))).toEqual({
		moveX: -1,
		jump: false,
		moveScale: TIMINGS.leap.speed,
		jumpScale: TIMINGS.leap.jump,
	});
});

test('the commit sets the leap timer, the cooldown and a fresh hit list', () => {
	const m = grounded(50);
	m.swingHits = [9];
	const after = pounce.commit?.(m);
	expect(after?.attackT).toBe(TOTAL);
	expect(after?.attackCdT).toBe(MELEE.commitCd);
	expect(after?.swingHits).toEqual([]);
});

test('touching down cuts the active window to the wobble recovery', () => {
	expect(pounce.afterStep?.(committed('active', true)).attackT).toBe(
		TIMINGS.recovery,
	);
});

test('a leap still in the air and a grounded wind-up keep their timer', () => {
	const airborne = committed('active', false);
	expect(pounce.afterStep?.(airborne).attackT).toBe(airborne.attackT);
	const windup = committed('windup', true);
	expect(pounce.afterStep?.(windup).attackT).toBe(windup.attackT);
});

test('the airborne body is the hitbox for exactly the active arc', () => {
	const airborne = committed('active', false);
	const strikes = pounce.project?.(airborne, {
		attackTBefore: airborne.attackT,
		nextProjectileId: 1,
	})?.strikes;
	expect(strikes).toHaveLength(1);
	expect(strikes?.[0]).toEqual({
		attackerId: airborne.id,
		attackerKind: 'monster',
		hitbox: entityBox(airborne),
		damage: MELEE.damage,
		poiseDamage: MELEE.poise,
		facing: -1,
		faction: 'monsters',
		attackerX: airborne.x,
		...meleeKnockback(MELEE),
	});
});

test('a grounded, winding-up or recovering pounce projects nothing', () => {
	const ctx = { attackTBefore: 0, nextProjectileId: 1 };
	for (const m of [
		committed('active', true),
		committed('windup', true),
		committed('recovery', true),
		grounded(50),
	])
		expect(pounce.project?.(m, ctx)?.strikes ?? []).toEqual([]);
});
