import { expect, test } from 'bun:test';
import { type Entity, emoteById, type Input } from '@mmo/core/entities';
import type { ClientMessage } from '@mmo/core/protocol';
import { bodyFrame } from '@mmo/core/sprites';
import { GameLoop } from '../../client/src/game/loop';
import { sendChatLine } from '../../client/src/net/chat';
import {
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioAvatar,
	scenarioZone,
} from './scenario';

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

test('an emote command predicts immediately and replicates once through the server', () => {
	const town = scenarioZone('town-square', 'town');
	const stack = createStackScenario({
		zones: [town],
		startZone: town.id,
		townZone: town.id,
	});
	const sender = joinScenarioPlayer(stack, 'Neo');
	const observer = joinScenarioPlayer(stack, 'Trinity');
	stack.advanceTick();
	let senderSnapshot = latestScenarioSnapshot(sender.client);
	latestScenarioSnapshot(observer.client);
	const definition = emoteById('wave');
	if (definition === undefined) throw new Error('expected registered emote');
	const loop = new GameLoop({
		net: {
			sessionId: sender.client.sessionId,
			zoneId: town.id,
			get latest() {
				return senderSnapshot;
			},
			chatLog: [],
			bubbles: new Map(),
			ownAvatar: () => scenarioAvatar(senderSnapshot, sender.client.sessionId),
			sample: () => senderSnapshot,
			decayBubbles: () => {},
			send: (message) => sender.client.send(message),
		},
		input: { poll: () => IDLE, consumeInteract: () => false },
		hud: {
			update: () => {},
			syncChat: () => {},
			flashLevelUp: () => {},
		},
		playfield: {
			game: null,
			emitPredicted: () => {},
			levelUpBurst: () => {},
		},
		sound: { play: () => {} },
		localZone: () => town,
		weapon: 0,
		modalOpen: () => false,
		syncViews: () => {},
	});
	for (let frame = 0; !loop.avatar.onGround; frame++) {
		if (frame === 10) throw new Error('predicted Avatar did not settle');
		loop.frame(50);
	}

	const emote = sendChatLine(sink(sender.client), `/${definition.id}`);
	if (emote) loop.emote(emote);
	expect(animationFor(loop.avatar)).toBe(`emote:${definition.id}`);

	stack.advanceTick();
	senderSnapshot = latestScenarioSnapshot(sender.client);
	const observerFrame = latestScenarioSnapshot(observer.client);
	const first = scenarioAvatar(observerFrame, sender.client.sessionId);
	expect(first.action.emote).toBe(definition.id);
	expect(animationFor(first)).toBe(`emote:${definition.id}`);
	expect(
		scenarioAvatar(senderSnapshot, sender.client.sessionId).action.emote,
	).toBe(definition.id);

	stack.advanceTick();
	const next = scenarioAvatar(
		latestScenarioSnapshot(observer.client),
		sender.client.sessionId,
	);
	expect(next.action.emote).toBe(definition.id);
	expect(next.action.emoteT).toBeLessThan(first.action.emoteT);

	stack.advanceTick(Math.ceil(definition.duration * sender.welcome.tickRate));
	const finished = scenarioAvatar(
		latestScenarioSnapshot(observer.client),
		sender.client.sessionId,
	);
	expect(finished.action.emote).toBeNull();
});

function sink(server: { send(message: ClientMessage): void }) {
	return {
		send: (message: ClientMessage) => server.send(message),
		notice: () => {},
	};
}

function animationFor(avatar: Entity | ReturnType<typeof scenarioAvatar>) {
	const action = avatar.action;
	const predictedEmote = 'emoteId' in avatar ? avatar.emoteId : null;
	const predictedEmoteT = 'emoteT' in avatar ? avatar.emoteT : 0;
	return bodyFrame({
		move: action?.move ?? 'idle',
		phase: action?.phase ?? null,
		swingProgress: action?.progress ?? 0,
		emote: action?.emote ?? predictedEmote ?? null,
		emoteT: action?.emoteT ?? predictedEmoteT ?? 0,
		airborne: !avatar.onGround,
		moving: avatar.vx !== 0,
		distanceX: avatar.x,
		staggered: false,
	}).animationId;
}
