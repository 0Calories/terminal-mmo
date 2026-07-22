import { expect, test } from 'bun:test';
import { type Projectile, spawnMonster } from '@mmo/core/entities';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import {
	createScenarioIdentity,
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioAvatar,
	scenarioInput,
	scenarioPortal,
	scenarioZone,
} from './scenario';

test('server runtime authenticates a new Player, creates an Avatar, and enters the starting Town', () => {
	const startZone = 'town-a';
	const tickRate = 37;
	const stack = createStackScenario({
		zones: lifecycleZones(),
		startZone,
		townZone: startZone,
		tickRate,
	});
	const { client: player, welcome } = joinScenarioPlayer(stack, 'Neo');

	expect(welcome.zoneId).toBe(startZone);
	expect(welcome.tickRate).toBe(tickRate);
	expect(welcome.handle).toBe('Neo');
	expect(welcome.isNew).toBe(true);

	stack.advanceTick();
	const snapshot = latestScenarioSnapshot(player);
	expect(snapshot.zoneId).toBe(startZone);
	expect(snapshot.monsters).toEqual([]);
	expect(snapshot.avatars).toContainEqual(
		expect.objectContaining({
			sessionId: welcome.sessionId,
			handle: 'Neo',
		}),
	);
});

test('server runtime restores durable state in the last safe Town without transient Field state', () => {
	const stack = createStackScenario({
		zones: lifecycleZones(),
		startZone: 'town-a',
		townZone: 'town-a',
	});
	const identity = createScenarioIdentity();
	const cosmetics = { hue: 4, hat: '', nameplate: 2, form: 'buddy' };
	const { client: first } = joinScenarioPlayer(stack, 'Trinity', {
		identity,
		cosmetics,
	});

	first.send(scenarioInput({ x: 10, interact: true }));
	stack.advanceTick();
	expect(latestScenarioSnapshot(first).zoneId).toBe('field-a');

	first.send(scenarioInput({ attack: true }));
	stack.advanceTick(4);
	let before = latestScenarioSnapshot(first);
	expect(before.progress.xp).toBeGreaterThan(0);
	expect(before.inventory).toHaveLength(1);
	const durableProgress = before.progress;

	first.send(scenarioInput({ x: 22 }));
	stack.advanceTick();
	before = latestScenarioSnapshot(first);
	expect(scenarioAvatar(before, first.sessionId).hp).toBeLessThan(
		scenarioAvatar(before, first.sessionId).maxHp,
	);

	first.send(scenarioInput({ x: 30, interact: true }));
	stack.advanceTick();
	expect(latestScenarioSnapshot(first).zoneId).toBe('town-b');

	first.send(scenarioInput({ x: 10, interact: true }));
	stack.advanceTick();
	expect(latestScenarioSnapshot(first).zoneId).toBe('field-b');

	first.send(scenarioInput({ x: 22 }));
	stack.advanceTick();
	before = latestScenarioSnapshot(first);
	expect(scenarioAvatar(before, first.sessionId).hurtT).toBeGreaterThan(0);

	first.send(scenarioInput({ x: 40 }));
	stack.advanceTick(14);
	before = latestScenarioSnapshot(first);
	expect(before.projectiles).toEqual([]);
	const beforeDisconnect = scenarioAvatar(before, first.sessionId);
	expect(beforeDisconnect.x).toBe(40);
	expect(beforeDisconnect.hp).toBeLessThan(beforeDisconnect.maxHp);
	const durableInventory = before.inventory;
	first.disconnect();

	stack.restart();
	const { client: returning, welcome } = joinScenarioPlayer(
		stack,
		'ignored-on-return',
		{ identity },
	);
	expect(welcome.isNew).toBe(false);
	expect(welcome.handle).toBe('Trinity');
	stack.advanceTick();
	const restored = latestScenarioSnapshot(returning);
	const avatar = scenarioAvatar(restored, returning.sessionId);
	expect(restored.zoneId).toBe('town-b');
	expect(restored.monsters).toEqual([]);
	expect(restored.projectiles).toEqual([]);
	expect(avatar.cosmetics).toEqual(cosmetics);
	expect(restored.progress).toEqual(durableProgress);
	expect(restored.inventory).toEqual(durableInventory);
	expect(avatar.hp).toBe(avatar.maxHp);
	expect(avatar.x).toBe(10);

	returning.send(scenarioInput({ x: 10, interact: true }));
	stack.advanceTick();
	const resetField = latestScenarioSnapshot(returning);
	expect(resetField.zoneId).toBe('field-b');
	expect(resetField.projectiles).toHaveLength(1);
});

function lifecycleZones(): Zone[] {
	const y = GROUND_TOP - 5;
	const projectile: Projectile = {
		id: 1,
		x: 24,
		y,
		vx: 0,
		vy: 0,
		life: 0.5,
		damage: 7,
		poiseDamage: 0,
		knockback: 0,
		knockbackUp: 0,
	};
	const weak = {
		...spawnMonster('chaser', 1, 15, y),
		hp: 1,
		maxHp: 1,
		speed: 0,
	};
	return [
		scenarioZone('town-a', 'town', {
			portals: [scenarioPortal('field-a')],
		}),
		scenarioZone('field-a', 'field', {
			monsters: [weak],
			projectiles: [projectile],
			nextProjectileId: 2,
			nextMonsterId: 2,
			portals: [scenarioPortal('town-b', 30)],
		}),
		scenarioZone('town-b', 'town', {
			portals: [scenarioPortal('field-b')],
		}),
		scenarioZone('field-b', 'field', {
			projectiles: [{ ...projectile, id: 2 }],
			nextProjectileId: 3,
		}),
	];
}
