import { describe, expect, test } from 'bun:test';
import {
	BOX,
	bloodEffect,
	type Entity,
	entityBox,
	hurtBloodEffect,
	meleeHitbox,
	predictHitEffects,
} from '../src';

function monster(x: number, y: number, over: Partial<Entity> = {}): Entity {
	return {
		id: 1,
		type: 'chaser',
		x,
		y,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

describe('bloodEffect', () => {
	test('bursts at the monster centre, biased along facing, scaled by damage', () => {
		const m = monster(10, 4);
		const e = bloodEffect(m, 1, 8);
		expect(e).toEqual({
			kind: 'blood',
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: 8,
			dir: 1,
		});
	});

	test('carries the attributing session as source when given', () => {
		const e = bloodEffect(monster(0, 0), -1, 5, 42);
		expect(e.dir).toBe(-1);
		expect(e.source).toBe(42);
	});
});

describe('hurtBloodEffect', () => {
	test('bursts at the Avatar centre, biased away from the source, scaled by damage', () => {
		const a = monster(10, 4);
		expect(hurtBloodEffect(a, 1, 6)).toEqual({
			kind: 'blood',
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: 6,
			dir: 1,
		});
	});

	test('carries a radial dir 0 when the direction is ambiguous', () => {
		expect(hurtBloodEffect(monster(0, 0), 0, 7).dir).toBe(0);
	});

	test('never attaches a source — hurt blood is server-sourced, delivered to the victim too', () => {
		expect(hurtBloodEffect(monster(0, 0), -1, 6).source).toBeUndefined();
	});
});

describe('predictHitEffects', () => {
	test('emits one blood Effect per overlapping, non-i-framed monster', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		// place a monster squarely inside the swing hitbox
		const target = monster(hb.x, hb.y, { id: 7 });
		const effects = predictHitEffects(hb, 1, 8, [target]);
		expect(effects).toHaveLength(1);
		expect(effects[0]).toEqual(bloodEffect(target, 1, 8));
	});

	test('skips monsters in i-frames (hurtT > 0)', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		const target = monster(hb.x, hb.y, { hurtT: 0.3 });
		expect(predictHitEffects(hb, 1, 8, [target])).toHaveLength(0);
	});

	test('skips monsters the hitbox does not overlap', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		const far = monster(hb.x + 100, hb.y);
		expect(predictHitEffects(hb, 1, 8, [far])).toHaveLength(0);
	});

	test('never attaches a source — predicted Effects are not reported upward', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		const target = monster(hb.x, hb.y);
		expect(predictHitEffects(hb, 1, 8, [target])[0].source).toBeUndefined();
		// sanity: the hitbox really does overlap the target
		expect(entityBox(target).x).toBeLessThan(hb.x + hb.w);
	});
});
