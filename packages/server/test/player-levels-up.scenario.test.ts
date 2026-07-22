import { expect, test } from 'bun:test';
import { DEFAULT_WEAPON } from '@mmo/core/combat';
import { type Input, spawnMonster } from '@mmo/core/entities';
import { emptySave } from '@mmo/core/persistence';
import { xpForKill, xpToNext } from '@mmo/core/progression';
import type { GameState } from '@mmo/core/protocol';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import { GameLoop } from '../../client/src/game/loop';
import {
	createScenarioIdentity,
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioInput,
	scenarioPortal,
	scenarioZone,
} from './scenario';

const FRAME_MS = 50;
const START_LEVEL = 1;
const MONSTER_ID = 99;
const HANDLE = 'Leveler';

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

test('authoritative Combat levels a Player and the client celebrates exactly once', () => {
	const field = combatField();
	const town = startingTown(field.id);
	const identity = createScenarioIdentity();
	const threshold = xpToNext(START_LEVEL);
	const startingProgress = {
		level: START_LEVEL,
		xp: threshold - 1,
		gold: 0,
	};
	const save = {
		...emptySave(HANDLE, town.id),
		progress: startingProgress,
	};
	const stack = createStackScenario({
		zones: [town, field],
		startZone: town.id,
		townZone: town.id,
		seedSaves: [{ publicKey: identity.publicKey, save }],
	});
	const { client: player, welcome } = joinScenarioPlayer(stack, HANDLE, {
		identity,
		weapon: DEFAULT_WEAPON,
	});
	expect(welcome.isNew).toBe(false);

	player.send(scenarioInput({ x: 10, interact: true }));
	stack.advanceTick();
	let snapshot = latestScenarioSnapshot(player);
	expect(snapshot.zoneId).toBe(field.id);
	expect(snapshot.progress).toEqual(startingProgress);

	let input = { ...IDLE };
	const sounds: string[] = [];
	let bursts = 0;
	let flashes = 0;
	const hudUpdates: GameState[] = [];
	const loop = new GameLoop({
		net: {
			sessionId: player.sessionId,
			zoneId: field.id,
			get latest() {
				return snapshot;
			},
			chatLog: [],
			bubbles: new Map(),
			ownAvatar: () =>
				snapshot.avatars.find(
					(avatar) => avatar.sessionId === player.sessionId,
				),
			sample: () => snapshot,
			decayBubbles: () => {},
			send: (message) => player.send(message),
		},
		input: {
			poll: () => input,
			consumeInteract: () => false,
		},
		hud: {
			update: (game) => hudUpdates.push(game),
			syncChat: () => {},
			flashLevelUp: () => flashes++,
		},
		playfield: {
			game: null,
			emitPredicted: () => {},
			levelUpBurst: () => bursts++,
		},
		sound: { play: (sound) => sounds.push(sound) },
		localZone: () => field,
		weapon: DEFAULT_WEAPON,
		modalOpen: () => false,
		syncViews: () => {},
	});

	loop.frame(FRAME_MS);
	input = { ...IDLE, attack: true };
	for (let frame = 0; snapshot.monsters.length > 0; frame++) {
		if (frame === 8) throw new Error('authored Monster was not defeated');
		loop.frame(FRAME_MS);
		stack.advanceTick();
		snapshot = latestScenarioSnapshot(player);
	}

	const configuredReward = xpForKill('chaser', field.id);
	expect(configuredReward).toBeGreaterThan(0);
	expect(snapshot.progress.level).toBeGreaterThan(START_LEVEL);
	expect(observedAward(startingProgress, snapshot.progress)).toBe(
		configuredReward,
	);

	input = { ...IDLE };
	loop.frame(FRAME_MS);
	expect(hudUpdates.at(-1)?.player.progress).toEqual(snapshot.progress);
	expect(sounds.filter((sound) => sound === 'level-up')).toHaveLength(1);
	expect(bursts).toBe(1);
	expect(flashes).toBe(1);

	stack.advanceTick();
	const unchanged = latestScenarioSnapshot(player);
	expect(unchanged.progress).toEqual(snapshot.progress);
	snapshot = unchanged;
	loop.frame(FRAME_MS);
	loop.frame(FRAME_MS);
	expect(sounds.filter((sound) => sound === 'level-up')).toHaveLength(1);
	expect(bursts).toBe(1);
	expect(flashes).toBe(1);
});

function observedAward(
	before: { level: number; xp: number },
	after: { level: number; xp: number },
): number {
	let award = xpToNext(before.level) - before.xp;
	for (let level = before.level + 1; level < after.level; level++)
		award += xpToNext(level);
	return award + after.xp;
}

function combatField(): Zone {
	return scenarioZone('field-01', 'field', {
		monsters: [
			{
				...spawnMonster('chaser', MONSTER_ID, 15, GROUND_TOP - 5),
				hp: 1,
				maxHp: 1,
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
