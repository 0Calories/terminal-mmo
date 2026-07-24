import { expect, test } from 'bun:test';
import type { BrainView, Entity } from '../../../../src/entities';
import { spawnMonster } from '../../../../src/entities';
import type {
	CombatContext,
	MovementEngine,
	Perception,
} from '../../../../src/entities/monsters';
import { pounceEngine } from '../../../../src/entities/monsters/slime';
import { flatTerrain, SPAWN_Y } from '../../../helpers';

const RANGE = 12;
const pounce = pounceEngine({ range: RANGE });
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
	const memory = { kind: 'hop' as const, restT: 3 };
	const movement: MovementEngine = {
		wander: () => ({ drive: { ...HOLD_DRIVE } }),
		moveToward: () => ({ drive: { ...HOLD_DRIVE }, memory }),
	};
	const m = grounded(50);
	expect(pounce.fight(context(m, m.x - RANGE, movement)).movement).toBe(memory);
});
