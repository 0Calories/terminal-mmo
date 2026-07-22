import { expect, test } from 'bun:test';
import type { ClientMessage, ServerMessage } from '@mmo/core/protocol';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import { sendChatLine } from '../../client/src/net/chat';
import { NetClient } from '../../client/src/net/net';
import {
	createStackScenario,
	joinScenarioPlayer,
	scenarioInput,
	scenarioZone,
} from './scenario';

test('Chat is confirmed in-zone while Whisper is private across Zones', () => {
	const stack = createStackScenario({
		zones: chatZones(),
		startZone: 'town-square',
		townZone: 'town-square',
	});
	const neo = join(stack, 'Neo');
	const trinity = join(stack, 'Trinity');
	const cypher = join(stack, 'Cypher');

	cypher.server.send(scenarioInput({ x: 24, interact: true }));
	stack.advanceTick();
	expect(cypher.server.take('snapshot').zoneId).toBe('quiet-zone');
	drainSnapshots(neo.server, trinity.server);

	sendChatLine(sink(neo.server), '  follow me  ');
	expect(neo.client.chatLog).toEqual([]);

	const senderChat = neo.server.take('chat');
	const observerChat = trinity.server.take('chat');
	expect(() => cypher.server.take('chat')).toThrow('expected chat');
	neo.client.ingest(senderChat, 1_000);
	trinity.client.ingest(observerChat, 1_000);

	expect(neo.client.chatLog).toEqual(['Neo: follow me']);
	expect(neo.client.bubbles.get(neo.server.sessionId)?.text).toBe('follow me');
	expect(trinity.client.chatLog).toEqual(['Neo: follow me']);
	expect(trinity.client.bubbles.get(neo.server.sessionId)?.text).toBe(
		'follow me',
	);
	expect(cypher.client.chatLog).toEqual([]);

	neo.client.bubbles.clear();
	cypher.client.bubbles.clear();
	sendChatLine(sink(neo.server), '/w Cypher the portal is clear');
	const sentWhisper = neo.server.take('whisper');
	const receivedWhisper = cypher.server.take('whisper');
	expect(() => trinity.server.take('whisper')).toThrow('expected whisper');
	neo.client.ingest(sentWhisper, 1_010);
	cypher.client.ingest(receivedWhisper, 1_010);

	expect(neo.client.chatLog.at(-1)).toBe('[you → Cypher] the portal is clear');
	expect(cypher.client.chatLog).toEqual(['[Neo → you] the portal is clear']);
	expect(neo.client.bubbles.size).toBe(0);
	expect(cypher.client.bubbles.size).toBe(0);
	expect(trinity.client.chatLog).toEqual(['Neo: follow me']);

	for (const player of [neo, trinity, cypher]) player.client.close();
});

function join(stack: ReturnType<typeof createStackScenario>, handle: string) {
	const server = joinScenarioPlayer(stack, handle).client;
	stack.advanceTick();
	server.take('snapshot');
	const client = new NetClient('ws://127.0.0.1:1', handle, {
		publicKey: '',
		signChallenge: async () => new Uint8Array(),
	});
	client.sessionId = server.sessionId;
	return { server, client };
}

function sink(server: { send(message: ClientMessage): void }) {
	return {
		send: (message: ClientMessage) => server.send(message),
		notice: () => {},
	};
}

function drainSnapshots(
	...clients: Array<{
		take<T extends ServerMessage['t']>(
			type: T,
		): Extract<ServerMessage, { t: T }>;
	}>
) {
	for (const client of clients) client.take('snapshot');
}

function chatZones(): Zone[] {
	const y = GROUND_TOP - 5;
	return [
		scenarioZone('town-square', 'town', {
			portals: [
				{
					x: 24,
					y: y - 2,
					w: 4,
					h: 7,
					target: 'quiet-zone',
					arrival: { x: 10, y },
				},
			],
		}),
		scenarioZone('quiet-zone', 'town'),
	];
}
