import { expect, test } from 'bun:test';
import { DEFAULT_WEAPON, weaponById } from '@mmo/core/combat';
import { type Input, spawnMonster } from '@mmo/core/entities';
import type { ServerMessage } from '@mmo/core/protocol';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import { GameLoop } from '../../client/src/game/loop';
import { present } from '../../client/src/render/present';
import { effectSoundCues } from '../../client/src/sound/world';
import {
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioInput,
	scenarioPortal,
	scenarioZone,
} from './scenario';

const FRAME_MS = 50;
const MONSTER_ID = 99;

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

test('a Player strike predicts one hit immediately, damages the Monster, and presents once to each client', () => {
	const field = combatField();
	const town = startingTown(field.id);
	const stack = createStackScenario({
		zones: [town, field],
		startZone: town.id,
		townZone: town.id,
	});
	const attacker = join(stack, 'Attacker');
	const observer = join(stack, 'Observer');

	attacker.send(scenarioInput({ x: 10, interact: true }));
	observer.send(scenarioInput({ x: 10, interact: true }));
	stack.advanceTick();
	let attackerSnapshot = latestScenarioSnapshot(attacker);
	latestScenarioSnapshot(observer);
	expect(attackerSnapshot.zoneId).toBe(field.id);
	const initialHp = monsterHp(attackerSnapshot);
	const predicted = [] as ReturnType<typeof present>[];
	let input = { ...IDLE };
	const loop = new GameLoop({
		net: {
			sessionId: attacker.sessionId,
			zoneId: field.id,
			get latest() {
				return attackerSnapshot;
			},
			chatLog: [],
			bubbles: new Map(),
			ownAvatar: () =>
				attackerSnapshot.avatars.find(
					(avatar) => avatar.sessionId === attacker.sessionId,
				),
			sample: () => attackerSnapshot,
			decayBubbles: () => {},
			send: (message) => attacker.send(message),
		},
		input: {
			poll: () => input,
			consumeInteract: () => false,
		},
		hud: {
			update: () => {},
			syncChat: () => {},
			flashLevelUp: () => {},
		},
		playfield: {
			game: null,
			emitPredicted: (events) => predicted.push(present(events)),
			levelUpBurst: () => {},
		},
		sound: { play: () => {} },
		localZone: () => field,
		weapon: DEFAULT_WEAPON,
		modalOpen: () => false,
		syncViews: () => {},
	});

	input = { ...IDLE, attack: true };
	for (
		let frame = 0;
		predicted.flatMap((show) => show.effects).length === 0;
		frame++
	) {
		if (frame === 5) throw new Error('attack never reached its active phase');
		loop.frame(FRAME_MS);
		if (predicted.flatMap((show) => show.effects).length > 0) break;
		stack.advanceTick();
		attackerSnapshot = latestScenarioSnapshot(attacker);
		latestScenarioSnapshot(observer);
	}

	const predictedPresentation = combine(predicted);
	expect(predictedPresentation.effects).toEqual([
		expect.objectContaining({
			kind: 'blood',
			intensity: weaponById(DEFAULT_WEAPON).damage,
			dir: 1,
		}),
	]);
	expect(predictedPresentation.sounds).toEqual(['hit']);
	expect(monsterHp(attackerSnapshot)).toBe(initialHp);

	stack.advanceTick();
	attackerSnapshot = latestScenarioSnapshot(attacker);
	const observerSnapshot = latestScenarioSnapshot(observer);
	const observerPresentation = project(observerSnapshot.events);
	const confirmedForAttacker = project(attackerSnapshot.events);

	expect(monsterHp(observerSnapshot)).toBe(
		initialHp - weaponById(DEFAULT_WEAPON).damage,
	);
	expect(observerSnapshot.events).toHaveLength(1);
	expect(observerSnapshot.events[0]).toEqual(
		expect.objectContaining({
			kind: 'hit',
			targetId: MONSTER_ID,
			intensity: weaponById(DEFAULT_WEAPON).damage,
			dir: 1,
		}),
	);
	expect(observerPresentation).toEqual(predictedPresentation);
	expect(attackerSnapshot.events).toEqual([]);
	expect(confirmedForAttacker).toEqual({ effects: [], sounds: [] });
	expect([
		...predictedPresentation.effects,
		...confirmedForAttacker.effects,
	]).toHaveLength(1);
});

function join(stack: ReturnType<typeof createStackScenario>, handle: string) {
	return joinScenarioPlayer(stack, handle, {
		weapon: DEFAULT_WEAPON,
	}).client;
}

function monsterHp(
	snapshot: Extract<ServerMessage, { t: 'snapshot' }>,
): number {
	const monster = snapshot.monsters.find(
		(candidate) => candidate.id === MONSTER_ID,
	);
	if (monster === undefined) throw new Error(`missing Monster ${MONSTER_ID}`);
	return monster.hp;
}

function project(events: Extract<ServerMessage, { t: 'snapshot' }>['events']) {
	const show = present(events);
	return {
		effects: show.effects,
		sounds: effectSoundCues(show.effects, 15, 40).map((cue) => cue.kind),
	};
}

function combine(shows: ReturnType<typeof present>[]) {
	const effects = shows.flatMap((show) => show.effects);
	return {
		effects,
		sounds: effectSoundCues(effects, 15, 40).map((cue) => cue.kind),
	};
}

function combatField(): Zone {
	return scenarioZone('field-01', 'field', {
		monsters: [
			{
				...spawnMonster('chaser', MONSTER_ID, 15, GROUND_TOP - 5),
				speed: 0,
			},
		],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		nextMonsterId: MONSTER_ID + 1,
	});
}

function startingTown(fieldId: string): Zone {
	return scenarioZone('town-square', 'town', {
		portals: [scenarioPortal(fieldId)],
	});
}
