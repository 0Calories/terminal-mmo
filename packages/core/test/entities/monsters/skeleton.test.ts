import { expect, test } from 'bun:test';
import {
	BOX,
	type BrainView,
	type Entity,
	spawnMonster,
} from '../../../src/entities';
import type {
	CombatEngine,
	MonsterMemory,
	MovementEngine,
} from '../../../src/entities/monsters';
import { skeletonBrain } from '../../../src/entities/monsters';
import { IDLE_DRIVE } from '../../../src/physics';
import { GROUND_TOP } from '../../../src/zones';
import { flatTerrain } from '../../helpers';

const VISION = 20;
const y = GROUND_TOP - BOX.h;
const flat = flatTerrain();

const WANDER_DRIVE = { moveX: 1, jump: false } as const;
const APPROACH_DRIVE = { moveX: -1, jump: false } as const;

function view(targetX: number | null): BrainView {
	return { terrain: flat, targetX };
}

/** Stub engines that record what the Skeleton asked of them, in order. */
function stubEngines() {
	const calls: string[] = [];
	const movement: MovementEngine = {
		wander: () => {
			calls.push('wander');
			return { ...WANDER_DRIVE };
		},
		moveToward: (_m, _v, destX) => {
			calls.push(`moveToward(${destX})`);
			return { ...APPROACH_DRIVE };
		},
	};
	const combat: CombatEngine = {
		fight: (ctx) => {
			calls.push('fight');
			const drive = ctx.movement.moveToward(
				ctx.monster,
				ctx.view,
				ctx.perception.targetX ?? ctx.monster.x,
			);
			return { ...drive, commit: 'swing' };
		},
	};
	return { calls, movement, combat };
}

function stubbedBrain() {
	const { calls, movement, combat } = stubEngines();
	return { calls, brain: skeletonBrain({ vision: VISION, movement, combat }) };
}

function grounded(x: number): Entity {
	const m = spawnMonster('chaser', 2, x, y);
	m.onGround = true;
	return m;
}

const stateOf = (ai: unknown) => (ai as MonsterMemory).state;

test('the Skeleton gates before it perceives: a stunned monster idles, engines untouched', () => {
	const { calls, brain } = stubbedBrain();
	const m = grounded(50);
	m.stunT = 0.2;
	const r = brain(m, view(m.x - 1));
	expect(r.drive).toEqual(IDLE_DRIVE);
	expect(calls).toEqual([]);
});

test('the committed gate runs before any engine gate can speak', () => {
	const { calls, brain } = stubbedBrain();
	const m = grounded(50);
	m.attackT = 0.2;
	const r = brain(m, view(m.x - 1));
	expect(r.drive).toEqual(IDLE_DRIVE);
	expect(calls).toEqual([]);
});

test('a gated monster keeps the state it arrived with', () => {
	const { brain } = stubbedBrain();
	const m = grounded(50);
	m.attackT = 0.2;
	m.ai = { state: 'combat' } satisfies MonsterMemory;
	expect(stateOf(brain(m, view(null)).ai)).toBe('combat');
});

test('in Patrol the Skeleton delegates to the Movement engine wander', () => {
	const { calls, brain } = stubbedBrain();
	const m = grounded(50);
	const r = brain(m, view(null));
	expect(r.drive).toEqual(WANDER_DRIVE);
	expect(calls).toEqual(['wander']);
	expect(stateOf(r.ai)).toBe('patrol');
});

test('in Combat the Combat engine leads and calls the Movement engine to close', () => {
	const { calls, brain } = stubbedBrain();
	const m = grounded(50);
	const targetX = m.x - 1;
	const r = brain(m, view(targetX));
	expect(r.drive.commit).toBe('swing');
	expect(r.drive.moveX).toBe(APPROACH_DRIVE.moveX);
	expect(calls).toEqual(['fight', `moveToward(${targetX})`]);
	expect(stateOf(r.ai)).toBe('combat');
});

test('vision is the enter edge: just inside is Combat, at the edge is Patrol', () => {
	const { brain } = stubbedBrain();
	const m = grounded(50);
	expect(stateOf(brain(m, view(m.x - (VISION - 0.01))).ai)).toBe('combat');
	expect(stateOf(brain(m, view(m.x - VISION)).ai)).toBe('patrol');
});

test('the Skeleton exits Combat the moment the target leaves vision', () => {
	const { calls, brain } = stubbedBrain();
	const m = grounded(50);
	m.ai = { state: 'combat' } satisfies MonsterMemory;
	const r = brain(m, view(m.x - VISION));
	expect(stateOf(r.ai)).toBe('patrol');
	expect(calls).toEqual(['wander']);
});

test('stored state never decides: entry is re-derived from vision every tick', () => {
	const { brain } = stubbedBrain();
	const inVision = 50 - (VISION - 1);
	const patrolling = grounded(50);
	patrolling.ai = { state: 'patrol' } satisfies MonsterMemory;
	const fighting = grounded(50);
	fighting.ai = { state: 'combat' } satisfies MonsterMemory;
	expect(brain(patrolling, view(inVision)).drive).toEqual(
		brain(fighting, view(inVision)).drive,
	);
	expect(stateOf(brain(patrolling, view(inVision)).ai)).toBe('combat');
});

test('a targetless monster patrols', () => {
	const { calls, brain } = stubbedBrain();
	const r = brain(grounded(50), view(null));
	expect(stateOf(r.ai)).toBe('patrol');
	expect(calls).toEqual(['wander']);
});
