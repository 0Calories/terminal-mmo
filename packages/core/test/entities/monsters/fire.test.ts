import { expect, test } from 'bun:test';
import {
	ARCHETYPES,
	BOX,
	type BrainView,
	type Entity,
	spawnMonster,
} from '../../../src/entities';
import type { EngineMemory, Perception } from '../../../src/entities/monsters';
import { fireEngine, walkEngine } from '../../../src/entities/monsters';
import { GROUND_TOP } from '../../../src/zones';
import { flatTerrain } from '../../helpers';

const { keepDist } = ARCHETYPES.shooter.ranged;
const y = GROUND_TOP - BOX.h;
const flat = flatTerrain();

const fire = fireEngine({ keepDist });
const movement = walkEngine({ deadzone: 0 });

function shooter(x: number): Entity {
	const m = spawnMonster('shooter', 2, x, y);
	m.onGround = true;
	m.attackCdT = 0;
	return m;
}

function perceive(m: Entity, targetX: number): Perception {
	const dx = targetX - m.x;
	return { targetX, dx, adx: Math.abs(dx), inVision: true };
}

function fight(m: Entity, targetX: number, memory?: EngineMemory) {
	const view: BrainView = { terrain: flat, targetX };
	return fire.fight({
		monster: m,
		view,
		perception: perceive(m, targetX),
		movement,
		memory: { state: 'combat', combat: memory },
	});
}

test('inside keep-distance the fire engine backs away facing the target, holding its shot', () => {
	const m = shooter(30);
	const { drive } = fight(m, m.x - (keepDist - 1));
	expect(drive.moveX).toBe(1);
	expect(drive.face).toBe(-1);
	expect(drive.jump).toBe(false);
	expect(drive.commit).toBeUndefined();
});

test('from the comfort band the fire engine holds ground and commits fire', () => {
	const m = shooter(50);
	const { drive } = fight(m, m.x - (keepDist + 5));
	expect(drive.moveX).toBe(0);
	expect(drive.face).toBe(-1);
	expect(drive.commit).toBe('fire');
});

test('on cooldown the fire engine holds the band without committing', () => {
	const m = shooter(50);
	m.attackCdT = 1;
	const { drive } = fight(m, m.x - (keepDist + 5));
	expect(drive.moveX).toBe(0);
	expect(drive.face).toBe(-1);
	expect(drive.commit).toBeUndefined();
});

test('the settle margin is hysteresis: a repositioning shooter keeps backing up past keepDist', () => {
	const m = shooter(50);
	const settling = fight(m, m.x - (keepDist - 1)).memory;
	const gap = keepDist + 0.5;

	expect(fight(m, m.x - gap).drive.commit).toBe('fire');

	const held = fight(m, m.x - gap, settling);
	expect(held.drive.commit).toBeUndefined();
	expect(held.drive.moveX).toBe(1);
});

test('the settle margin ends: far enough out the repositioning shooter settles and fires', () => {
	const m = shooter(50);
	const settling = fight(m, m.x - (keepDist - 1)).memory;
	const { drive } = fight(m, m.x - (keepDist + 5), settling);
	expect(drive.moveX).toBe(0);
	expect(drive.commit).toBe('fire');
});

test('reposition then attack: fire is committed only once the band is restored', () => {
	let m = shooter(30);
	const targetX = m.x - (keepDist - 1);
	let memory: EngineMemory | undefined;
	let committedFire = false;

	for (let i = 0; i < 30 && !committedFire; i++) {
		const { drive, memory: next } = fight(m, targetX, memory);
		memory = next;
		if (drive.commit === 'fire') {
			committedFire = true;
			expect(Math.abs(targetX - m.x)).toBeGreaterThanOrEqual(keepDist);
			break;
		}
		expect(drive.moveX).toBe(1);
		m = { ...m, x: m.x + 1 };
	}
	expect(committedFire).toBe(true);
});
