import { expect, test } from 'bun:test';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import { createTestRenderer } from '@opentui/core/testing';
import {
	createStackScenario,
	joinScenarioPlayer,
	scenarioAvatar,
	scenarioInput,
	scenarioPortal,
	scenarioZone,
} from '../../server/test/scenario';
import { GameLoop } from '../src/game/loop';
import { INTERP_DELAY_MS } from '../src/net/interp';
import { NetClient } from '../src/net/net';
import { ParticleEngine } from '../src/particles';
import { PlayfieldRenderable } from '../src/render/playfield';
import { seededRng } from './helpers';

const RECEIVED_AT = 10_000;

test('one Interact enters a Portal once and switches the client to its arrival', async () => {
	const zones = portalZones();
	const stack = createStackScenario({
		zones,
		startZone: 'west-town',
		townZone: 'west-town',
	});
	const { client: server, welcome } = joinScenarioPlayer(stack, 'Neo');
	stack.advanceTick();
	const initial = server.take('snapshot');
	const client = await clientView(welcome, initial, zones);
	client.particles.spawn('impact', { x: 24, y: GROUND_TOP - 5 }, 0, 5);
	expect(client.particles.activeCount).toBeGreaterThan(0);

	server.send(scenarioInput({ x: 24, interact: true }));
	stack.advanceTick();
	const arrived = server.take('snapshot');
	expect(arrived.zoneId).toBe('east-town');
	expect(scenarioAvatar(arrived, server.sessionId)).toEqual(
		expect.objectContaining({ x: 24, y: GROUND_TOP - 5 }),
	);

	const receivedAt = RECEIVED_AT + 16;
	await client.ingest(arrived, receivedAt);
	expect(client.loop.currentZone.id).toBe('east-town');
	expect(client.loop.avatar).toEqual(
		expect.objectContaining({ x: 24, y: GROUND_TOP - 5 }),
	);
	expect(client.playfield.game?.player.zoneId).toBe('east-town');
	expect(client.net.sample(receivedAt + INTERP_DELAY_MS)?.zoneId).toBe(
		'east-town',
	);
	expect(client.particles.activeCount).toBe(0);

	stack.advanceTick();
	const settled = server.take('snapshot');
	expect(settled.zoneId).toBe('east-town');
	expect(scenarioAvatar(settled, server.sessionId)).toEqual(
		expect.objectContaining({ x: 24, y: GROUND_TOP - 5 }),
	);
	client.net.close();
});

async function clientView(
	welcome: Extract<
		import('@mmo/core/protocol').ServerMessage,
		{ t: 'welcome' }
	>,
	initial: Extract<
		import('@mmo/core/protocol').ServerMessage,
		{ t: 'snapshot' }
	>,
	zones: Zone[],
) {
	const renderer = await createTestRenderer({ width: 60, height: 20 });
	let now = 0;
	let receivedAt = RECEIVED_AT;
	const particles = new ParticleEngine(seededRng(0x426));
	const playfield = new PlayfieldRenderable(renderer.renderer, {
		now: () => now,
		particles,
	});
	renderer.renderer.root.add(playfield);
	const net = new NetClient('ws://127.0.0.1:1', 'Neo', {
		publicKey: '',
		signChallenge: async () => new Uint8Array(),
	});
	net.ingest(welcome, RECEIVED_AT);
	net.ingest(initial, RECEIVED_AT);
	const byId = new Map(zones.map((zone) => [zone.id, zone]));
	const loop = new GameLoop({
		net,
		input: { poll: () => idle(), consumeInteract: () => false },
		hud: { update: () => {}, syncChat: () => {}, flashLevelUp: () => {} },
		playfield,
		sound: { play: () => {} },
		localZone: (id) => byId.get(id) ?? zones[0],
		weapon: 0,
		now: () => receivedAt + INTERP_DELAY_MS + 5,
		modalOpen: () => false,
		syncViews: () => {},
	});
	loop.frame(16);
	await renderer.renderOnce();
	return {
		net,
		loop,
		playfield,
		particles,
		ingest: async (
			snapshot: Extract<
				import('@mmo/core/protocol').ServerMessage,
				{ t: 'snapshot' }
			>,
			at: number,
		) => {
			receivedAt = at;
			net.ingest(snapshot, receivedAt);
			loop.frame(16);
			now += 16;
			await renderer.renderOnce();
		},
	};
}

function portalZones(): Zone[] {
	return [
		scenarioZone('west-town', 'town', {
			portals: [scenarioPortal('east-town', 24, 24)],
		}),
		scenarioZone('east-town', 'town', {
			portals: [scenarioPortal('west-town', 24, 24)],
		}),
	];
}

function idle() {
	return {
		moveX: 0 as const,
		jump: false,
		attack: false,
		guard: false,
		interact: false,
	};
}
