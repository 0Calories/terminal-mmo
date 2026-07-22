import { expect, test } from 'bun:test';
import { COMBAT, DEFAULT_WEAPON } from '@mmo/core/combat';
import { type Input, meleeProfileOf, spawnMonster } from '@mmo/core/entities';
import type { GameState } from '@mmo/core/protocol';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import { createTestRenderer } from '@opentui/core/testing';
import {
	createStackScenario,
	joinScenarioPlayer,
	latestScenarioSnapshot,
	scenarioAvatar,
	scenarioInput,
	scenarioPortal,
	scenarioZone,
} from '../../server/test/scenario';
import { GameLoop } from '../src/game/loop';
import { ParticleEngine } from '../src/particles';
import { PlayfieldRenderable } from '../src/render/playfield';
import { present } from '../src/render/present';
import { seededRng } from './helpers';

const MONSTER_ID = 98;
const FRAME_MS = 16;
const VIEW = { width: 60, height: 20 } as const;

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

test('an authored Monster strike reconciles and presents once on the struck client', async () => {
	const field = combatField();
	const town = startingTown(field.id);
	const stack = createStackScenario({
		zones: [town, field],
		startZone: town.id,
		townZone: town.id,
	});
	const player = joinScenarioPlayer(stack, 'Tank').client;
	player.send(scenarioInput({ x: 10, interact: true }));

	stack.advanceTick();
	expect(latestScenarioSnapshot(player).zoneId).toBe(field.id);
	stack.advanceTick(4);
	const snapshot = latestScenarioSnapshot(player);
	const avatar = scenarioAvatar(snapshot, player.sessionId);
	const attack = meleeProfileOf('chaser');
	if (attack === null) throw new Error('chaser must have a melee profile');
	expect(avatar.hp).toBe(avatar.maxHp - attack.damage);
	expect(avatar.hurtT).toBe(COMBAT.iframes);
	expect(snapshot.events).toEqual([
		expect.objectContaining({
			kind: 'hit',
			targetId: player.sessionId,
			intensity: attack.damage,
		}),
	]);

	let latest = snapshot;
	const playfieldView = {
		game: null as GameState | null,
		emitPredicted: () => {},
		levelUpBurst: () => {},
	};
	const loop = new GameLoop({
		net: {
			sessionId: player.sessionId,
			zoneId: field.id,
			get latest() {
				return latest;
			},
			chatLog: [],
			bubbles: new Map(),
			ownAvatar: () => scenarioAvatar(latest, player.sessionId),
			sample: () => latest,
			decayBubbles: () => {},
			send: (message) => player.send(message),
		},
		input: { poll: () => IDLE, consumeInteract: () => false },
		hud: {
			update: () => {},
			syncChat: () => {},
			flashLevelUp: () => {},
		},
		playfield: playfieldView,
		sound: { play: () => {} },
		localZone: () => field,
		weapon: DEFAULT_WEAPON,
		modalOpen: () => false,
		syncViews: () => {},
	});
	loop.frame(FRAME_MS);
	expect(loop.avatar.hp).toBe(avatar.hp);
	expect(loop.avatar.hurtT).toBe(COMBAT.iframes);
	const damagedGame = gameFrom(playfieldView);
	expect(damagedGame.events).toEqual(snapshot.events);

	const hit = await mountPlayfield(damagedGame);
	expect(present(damagedGame.events ?? []).effects).toEqual([
		expect.objectContaining({
			kind: 'blood',
			intensity: attack.damage,
		}),
	]);
	expect(hit.particles.activeCount).toBeGreaterThan(0);
	expect(hit.sounds).toEqual(['hit']);
	const particleCount = hit.particles.activeCount;

	await hit.renderOnce();
	expect(hit.particles.activeCount).toBe(particleCount);
	expect(hit.sounds).toEqual(['hit']);

	stack.advanceTick();
	latest = latestScenarioSnapshot(player);
	expect(scenarioAvatar(latest, player.sessionId).hp).toBe(avatar.hp);
	expect(latest.events).toEqual([]);
	loop.frame(FRAME_MS);
	hit.playfield.game = gameFrom(playfieldView);
	await hit.renderOnce();
	expect(hit.particles.activeCount).toBe(particleCount);
	expect(hit.sounds).toEqual(['hit']);
});

function gameFrom(view: { game: GameState | null }): GameState {
	if (view.game === null) throw new Error('client did not produce a GameState');
	return view.game;
}

async function mountPlayfield(game: GameState) {
	const testRenderer = await createTestRenderer(VIEW);
	const particles = new ParticleEngine(seededRng(0x423));
	const playfield = new PlayfieldRenderable(testRenderer.renderer, {
		now: () => 0,
		particles,
	});
	const sounds: string[] = [];
	playfield.sound = { play: (kind) => sounds.push(kind) };
	playfield.game = game;
	testRenderer.renderer.root.add(playfield);
	await testRenderer.renderOnce();
	return {
		playfield,
		particles,
		sounds,
		renderOnce: testRenderer.renderOnce,
	};
}

function combatField(): Zone {
	return scenarioZone('field-01', 'field', {
		monsters: [
			{
				...spawnMonster('chaser', MONSTER_ID, 14, GROUND_TOP - 5),
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
