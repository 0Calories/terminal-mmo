import { describe, expect, test } from 'bun:test';
import {
	COMBAT,
	type CombatEvent,
	combatEventAt,
	deathEvent,
	swatEvent,
} from '@mmo/core/combat';
import { present } from '../src/render/present';
import { entity, makeProjectile } from './helpers';

const TARGET = entity({ id: 9, type: 'chaser', x: 20, y: 8 });

describe('present routes a CombatEvent to client presentation', () => {
	test('a hit routes to a single blood effect at the event position, intensity, and dir — no kick, no hitstop', () => {
		const event = combatEventAt('hit', TARGET, 1, 7, 3);
		const show = present([event]);

		expect(show.effects).toEqual([
			{
				kind: 'blood',
				x: event.x,
				y: event.y,
				intensity: 7,
				dir: 1,
			},
		]);
		expect(show.kicks).toEqual([]);
		expect(show.hitstop).toBe(false);
	});

	test('a hit drops the server-internal source, even when the event carries one', () => {
		const event = combatEventAt('hit', TARGET, 1, 7, 3);
		const [fx] = present([event]).effects;

		expect(fx).not.toHaveProperty('source');
	});

	test('a break is the one place impact + kick + hitstop mean the same moment', () => {
		const event = combatEventAt('break', TARGET, -1, 5);
		const show = present([event]);

		expect(show.effects).toEqual([
			{
				kind: 'impact',
				x: event.x,
				y: event.y,
				intensity: 5 + COMBAT.poise.max,
				dir: -1,
			},
		]);
		expect(show.kicks).toEqual([-1]);
		expect(show.hitstop).toBe(true);
	});

	test('a death routes to gore and preserves the tint — no kick, no hitstop', () => {
		const dying = entity({ id: 9, type: 'brute', x: 20, y: 8 });
		const event = deathEvent(dying);
		if (event.kind !== 'death') throw new Error('expected a death event');
		const show = present([event]);

		expect(show.effects[0].kind).toBe('gore');
		expect(show.effects[0].tint).toBeDefined();
		expect(show.effects[0].tint).toEqual(event.tint);
		expect(show.kicks).toEqual([]);
		expect(show.hitstop).toBe(false);
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
		const [fx] = present([event]).effects;

		expect(fx).not.toHaveProperty('tint');
	});

	test('a swat routes to an impact at the projectile intensity, punching and freezing like any impact', () => {
		const pr = makeProjectile({ id: 3, x: 20, y: 8, vx: -9 });
		const event = swatEvent(pr, -1);
		const show = present([event]);

		expect(show.effects).toEqual([
			{
				kind: 'impact',
				x: event.x,
				y: event.y,
				intensity: pr.damage,
				dir: -1,
			},
		]);
		expect(show.kicks).toEqual([-1]);
		expect(show.hitstop).toBe(true);
	});

	test('a mixed frame accumulates every effect and one kick per big moment', () => {
		const events = [
			combatEventAt('hit', TARGET, 1, 7),
			combatEventAt('break', TARGET, -1, 5),
			deathEvent(entity({ id: 9, type: 'brute', x: 20, y: 8 })),
		];
		const show = present(events);

		expect(show.effects.map((fx) => fx.kind)).toEqual([
			'blood',
			'impact',
			'gore',
		]);
		expect(show.kicks).toEqual([-1]);
		expect(show.hitstop).toBe(true);
	});
});

describe('present routes hit/break CombatEvents to Damage numbers', () => {
	test('a hit yields a hit-styled number at the event spot showing the damage dealt', () => {
		const event = combatEventAt('hit', TARGET, 1, 7);
		const show = present([event]);

		expect(show.numbers).toEqual([
			{
				style: 'hit',
				targetId: TARGET.id,
				x: event.x,
				y: event.y,
				value: 7,
				own: false,
			},
		]);
	});

	test('a break yields a break-styled number at the raw damage, not the impact intensity', () => {
		const event = combatEventAt('break', TARGET, -1, 5);
		const [n] = present([event]).numbers;

		expect(n.style).toBe('break');
		expect(n.value).toBe(5);
	});

	test('death and swat produce no number', () => {
		const pr = makeProjectile({ id: 3, x: 20, y: 8, vx: -9 });
		const show = present([
			deathEvent(entity({ id: 9, type: 'brute', x: 20, y: 8 })),
			swatEvent(pr, -1),
		]);

		expect(show.numbers).toEqual([]);
	});

	test('an Avatar target flips both kinds to the avatar style', () => {
		const avatarIds = new Set([TARGET.id]);
		const show = present(
			[
				combatEventAt('hit', TARGET, 1, 7),
				combatEventAt('break', TARGET, 1, 5),
			],
			{ avatarIds },
		);

		expect(show.numbers.map((n) => n.style)).toEqual(['avatar', 'avatar']);
	});

	test('a source matching the own session marks the number as own — for the predicted hit and the converting break alike', () => {
		const show = present(
			[
				combatEventAt('hit', TARGET, 1, 7, 3),
				combatEventAt('break', TARGET, 1, 5, 3),
			],
			{ selfId: 3 },
		);

		expect(show.numbers.map((n) => n.own)).toEqual([true, true]);
	});

	test('a foreign or absent source never marks a number as own', () => {
		const show = present(
			[
				combatEventAt('break', TARGET, 1, 5, 8),
				combatEventAt('break', TARGET, 1, 5),
			],
			{ selfId: 3 },
		);

		expect(show.numbers.map((n) => n.own)).toEqual([false, false]);
	});
});
