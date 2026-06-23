import { describe, expect, test } from 'bun:test';
import {
	BOX,
	bloodEffect,
	COMBAT,
	deathGoreEffect,
	type Entity,
	entityBox,
	entityTint,
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

describe('entityTint', () => {
	test('a monster takes its sprite body colour (chaser = red)', () => {
		expect(entityTint(monster(0, 0, { type: 'chaser' }))).toEqual({
			r: 220,
			g: 90,
			b: 90,
		});
	});

	test('a different monster takes its own body colour (shooter = bone)', () => {
		expect(entityTint(monster(0, 0, { type: 'shooter' }))).toEqual({
			r: 232,
			g: 230,
			b: 216,
		});
	});

	test('an Avatar takes its cosmetic hue, not the default body colour', () => {
		const a = monster(0, 0, {
			type: 'player',
			cosmetics: { hue: 3, hat: 0, nameplate: 0 },
		});
		expect(entityTint(a)).toEqual({ r: 90, g: 170, b: 255 }); // HUES[3] = blue
	});

	test('a stray cosmetic hue falls back to the default amber body', () => {
		const a = monster(0, 0, {
			type: 'player',
			cosmetics: { hue: 999, hat: 0, nameplate: 0 },
		});
		expect(entityTint(a)).toEqual({ r: 255, g: 150, b: 40 }); // HUES[0]
	});
});

describe('deathGoreEffect', () => {
	test('bursts radially (dir 0) at the entity centre, high intensity, tinted by the entity', () => {
		const m = monster(10, 4);
		const e = deathGoreEffect(m);
		expect(e).toEqual({
			kind: 'gore',
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: COMBAT.deathBurstIntensity,
			dir: 0,
			tint: { r: 220, g: 90, b: 90 },
		});
	});

	test('reads visibly bigger than a chip hit — intensity above melee damage', () => {
		expect(COMBAT.deathBurstIntensity).toBeGreaterThan(COMBAT.meleeDamage);
	});

	test('carries no source — death gore is delivered to everyone in range', () => {
		expect(deathGoreEffect(monster(0, 0)).source).toBeUndefined();
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
