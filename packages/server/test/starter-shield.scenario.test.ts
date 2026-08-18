import { expect, test } from 'bun:test';
import { ACTION_FLAG, COMBAT } from '@mmo/core/combat';
import { DEFAULT_COSMETICS, MONSTERS, spawnMonster } from '@mmo/core/entities';
import { STARTER_SHIELD } from '@mmo/core/items';
import { emptySave, type PlayerSave } from '@mmo/core/persistence';
import { GROUND_TOP } from '@mmo/core/zones';
import {
	createScenarioIdentity,
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioAvatar,
	scenarioInput,
	scenarioZone,
} from './scenario';

test('a fresh Avatar spawns with the starter Shield and blocks a Monster hit end-to-end', () => {
	const field = scenarioZone('field-01', 'field', {
		monsters: [
			{ ...spawnMonster('chaser', 99, 15, GROUND_TOP - 5), x: 15, speed: 0 },
		],
	});
	const stack = createStackScenario({
		zones: [field],
		startZone: field.id,
		townZone: field.id,
	});
	const { client, welcome } = joinScenarioPlayer(stack, 'Novice');
	expect(welcome.isNew).toBe(true);
	stack.advanceTick();
	let snapshot = latestScenarioSnapshot(client);
	expect(snapshot.progress.level).toBe(1);
	expect(scenarioAvatar(snapshot, client.sessionId).offhand).toBe(
		STARTER_SHIELD,
	);
	expect(
		snapshot.inventory.filter((item) => item.slot === 'offhand'),
	).toHaveLength(1);

	const maxHp = scenarioAvatar(snapshot, client.sessionId).maxHp;
	let avatar = scenarioAvatar(snapshot, client.sessionId);
	for (let tick = 0; avatar.hp === maxHp; tick++) {
		if (tick === 200) throw new Error('the Monster never struck the Avatar');
		client.send(scenarioInput({ x: 13, facing: 1, guard: true }));
		stack.advanceTick();
		snapshot = latestScenarioSnapshot(client);
		avatar = scenarioAvatar(snapshot, client.sessionId);
	}

	const chip = Math.ceil(MONSTERS.chaser.stats.damage * COMBAT.guard.blockChip);
	expect(maxHp - avatar.hp).toBe(chip);
	expect(maxHp - avatar.hp).toBeLessThan(MONSTERS.chaser.stats.damage);
	expect(avatar.action.flags & ACTION_FLAG.guarding).toBe(ACTION_FLAG.guarding);
});

test('a legacy Save with no offhand comes back migrated — starter Shield granted and equipped', () => {
	const town = scenarioZone('town-square', 'town');
	const identity = createScenarioIdentity();
	const { equippedOffhand: _none, ...base } = emptySave('Veteran', town.id);
	const legacy: PlayerSave = { ...base, inventory: [] };
	const stack = createStackScenario({
		zones: [town],
		startZone: town.id,
		townZone: town.id,
		seedSaves: [{ publicKey: identity.publicKey, save: legacy }],
	});

	const { client, welcome } = joinScenarioPlayer(stack, 'Veteran', {
		identity,
	});
	expect(welcome.isNew).toBe(false);
	stack.advanceTick();
	const snapshot = latestScenarioSnapshot(client);
	expect(scenarioAvatar(snapshot, client.sessionId).offhand).toBe(
		STARTER_SHIELD,
	);
	expect(
		snapshot.inventory.filter((item) => item.slot === 'offhand'),
	).toHaveLength(1);
});

test('a deliberate unequip persists across relogin without a re-grant, and re-equip restores it', () => {
	const town = scenarioZone('town-square', 'town');
	const stack = createStackScenario({
		zones: [town],
		startZone: town.id,
		townZone: town.id,
	});
	const { client, identity } = joinScenarioPlayer(stack, 'Chooser');
	stack.advanceTick();
	let snapshot = latestScenarioSnapshot(client);
	expect(scenarioAvatar(snapshot, client.sessionId).offhand).toBe(
		STARTER_SHIELD,
	);

	client.send({ t: 'unequip', slot: 'offhand' });
	stack.advanceTick();
	snapshot = latestScenarioSnapshot(client);
	expect(scenarioAvatar(snapshot, client.sessionId).offhand).toBeNull();
	expect(
		snapshot.inventory.filter((item) => item.slot === 'offhand'),
	).toHaveLength(1);
	client.disconnect();

	const returning = stack.connect();
	const welcome = returning.authenticate({
		identity,
		handle: 'Chooser',
		cosmetics: DEFAULT_COSMETICS,
	});
	expect(welcome.isNew).toBe(false);
	stack.advanceTick();
	snapshot = latestScenarioSnapshot(returning);
	expect(scenarioAvatar(snapshot, returning.sessionId).offhand).toBeNull();
	const shields = snapshot.inventory.filter((item) => item.slot === 'offhand');
	expect(shields).toHaveLength(1);

	returning.send({ t: 'equip', itemId: shields[0].id });
	stack.advanceTick();
	snapshot = latestScenarioSnapshot(returning);
	expect(scenarioAvatar(snapshot, returning.sessionId).offhand).toBe(
		STARTER_SHIELD,
	);
});
