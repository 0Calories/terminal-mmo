import { expect, test } from 'bun:test';
import { DEFAULT_COSMETICS } from '@mmo/core/entities';
import { STARTER_SHIELD } from '@mmo/core/items';
import { emptySave, type PlayerSave } from '@mmo/core/persistence';
import {
	createScenarioIdentity,
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioAvatar,
	scenarioZone,
} from './scenario';

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
