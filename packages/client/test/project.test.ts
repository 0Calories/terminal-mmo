import { describe, expect, test } from 'bun:test';
import type { CombatEvent } from '@mmo/core/combat';
import { COMBAT, combatEventAt, deathEvent, swatEvent } from '@mmo/core/combat';
import { effectsOf } from '../src/effects/project';
import { entity, makeProjectile } from './helpers';

const TARGET = entity({ id: 9, type: 'chaser', x: 20, y: 8 });

describe('effectsOf projects a CombatEvent to client VisualEffects', () => {
	test('a hit projects to a single blood effect at the event position, intensity, and dir', () => {
		const event = combatEventAt('hit', TARGET, 1, 7, 3);
		const [fx] = effectsOf(event);

		expect(fx).toEqual({
			kind: 'blood',
			x: event.x,
			y: event.y,
			intensity: 7,
			dir: 1,
		});
	});

	test('a hit drops the server-internal source, even when the event carries one', () => {
		const event = combatEventAt('hit', TARGET, 1, 7, 3);
		const [fx] = effectsOf(event);

		expect(fx).not.toHaveProperty('source');
	});

	test('a break projects to an impact whose intensity adds the poise max', () => {
		const event = combatEventAt('break', TARGET, -1, 5);
		const [fx] = effectsOf(event);

		expect(fx).toEqual({
			kind: 'impact',
			x: event.x,
			y: event.y,
			intensity: 5 + COMBAT.poise.max,
			dir: -1,
		});
	});

	test('a death projects to gore and preserves the tint', () => {
		const dying = entity({ id: 9, type: 'brute', x: 20, y: 8 });
		const event = deathEvent(dying);
		if (event.kind !== 'death') throw new Error('expected a death event');
		const [fx] = effectsOf(event);

		expect(fx.kind).toBe('gore');
		expect(fx.tint).toBeDefined();
		expect(fx.tint).toEqual(event.tint);
	});

	test('a tintless death yields a gore with no tint key', () => {
		const event: CombatEvent = {
			kind: 'death',
			targetId: TARGET.id,
			x: TARGET.x,
			y: TARGET.y,
			dir: 0,
			intensity: 4,
		};
		const [fx] = effectsOf(event);

		expect(fx).not.toHaveProperty('tint');
	});

	test('a swat projects to an impact at the projectile intensity, with dir preserved', () => {
		const pr = makeProjectile({ id: 3, x: 20, y: 8, vx: -9 });
		const event = swatEvent(pr, -1);
		const [fx] = effectsOf(event);

		expect(fx).toEqual({
			kind: 'impact',
			x: event.x,
			y: event.y,
			intensity: pr.damage,
			dir: -1,
		});
	});
});
