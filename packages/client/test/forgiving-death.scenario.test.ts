import { expect, test } from 'bun:test';
import { DEFAULT_WEAPON } from '@mmo/core/combat';
import { meleeProfileOf, spawnMonster } from '@mmo/core/entities';
import {
	activeZone,
	type GameState,
	type ServerMessage,
} from '@mmo/core/protocol';
import { TOWN_SPAWN } from '@mmo/core/world';
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

const TOWN_ID = 'haven';
const DUNGEON_ID = 'crypt';
const MONSTER_ID = 80;
const FRAME_MS = 16;
const MAX_DEATH_TICKS = 200;
const VIEW = { width: 60, height: 20 } as const;

test('fatal authored Monster combat returns the last Dungeon occupant to a fresh entry', async () => {
	const zones = deathZones();
	const stack = createStackScenario({
		zones,
		startZone: TOWN_ID,
		townZone: TOWN_ID,
	});
	const { client: player, welcome } = joinScenarioPlayer(stack, 'Ember');
	stack.advanceTick();
	const initial = player.take('snapshot');
	const client = await clientView(welcome, initial, zones);

	player.send(scenarioInput({ x: 24, interact: true }));
	stack.advanceTick();
	const entered = player.take('snapshot');
	expect(entered.zoneId).toBe(DUNGEON_ID);
	expect(entered.avatars.map((avatar) => avatar.sessionId)).toEqual([
		player.sessionId,
	]);
	expect(entered.projectiles).toHaveLength(1);
	await client.ingest(entered);
	expect(client.loop.currentZone.id).toBe(DUNGEON_ID);

	player.send(scenarioInput({ x: TOWN_SPAWN.x }));
	const attack = meleeProfileOf('chaser');
	if (attack === null) throw new Error('chaser must have a melee profile');
	let priorHp = scenarioAvatar(entered, player.sessionId).hp;
	let lastDungeon = entered;
	let defeated: Extract<ServerMessage, { t: 'snapshot' }> | undefined;
	let markerExpired = false;
	let presentedHits = 0;
	let sawTransientEffects = false;

	for (let tick = 0; tick < MAX_DEATH_TICKS; tick++) {
		stack.advanceTick();
		const snapshot = player.take('snapshot');
		const soundsBefore = client.sounds.length;
		await client.ingest(snapshot);
		sawTransientEffects ||= client.particles.activeCount > 0;

		if (snapshot.zoneId === TOWN_ID) {
			defeated = snapshot;
			break;
		}

		markerExpired ||= snapshot.projectiles.length === 0;
		const avatar = scenarioAvatar(snapshot, player.sessionId);
		const incoming = snapshot.events.filter(
			(event) =>
				(event.kind === 'hit' || event.kind === 'break') &&
				event.targetId === player.sessionId,
		);
		if (incoming.length > 0) {
			expect(incoming).toHaveLength(1);
			expect(incoming[0]).toEqual(
				expect.objectContaining({
					intensity: attack.damage,
					targetId: player.sessionId,
				}),
			);
			expect(priorHp - avatar.hp).toBe(attack.damage);
			expect(client.sounds.slice(soundsBefore)).toEqual(['hit']);
			presentedHits++;

			const soundsAfterFirstRender = client.sounds.length;
			await client.renderAgain();
			expect(client.sounds).toHaveLength(soundsAfterFirstRender);
		}
		priorHp = avatar.hp;
		lastDungeon = snapshot;
	}

	if (defeated === undefined)
		throw new Error(`Avatar was not defeated within ${MAX_DEATH_TICKS} ticks`);
	const hpBeforeFatalStrike = scenarioAvatar(lastDungeon, player.sessionId).hp;
	expect(presentedHits).toBeGreaterThan(0);
	expect(sawTransientEffects).toBe(true);
	expect(markerExpired).toBe(true);
	expect(hpBeforeFatalStrike).toBeGreaterThan(0);
	expect(hpBeforeFatalStrike).toBeLessThanOrEqual(attack.damage);
	expect(defeated.zoneId).toBe(TOWN_ID);
	expect(defeated.events).toEqual([]);
	expect(defeated.monsters).toEqual([]);
	expect(defeated.projectiles).toEqual([]);
	expect(scenarioAvatar(defeated, player.sessionId)).toEqual(
		expect.objectContaining({
			hp: scenarioAvatar(defeated, player.sessionId).maxHp,
			x: TOWN_SPAWN.x,
			y: TOWN_SPAWN.y,
		}),
	);
	expect(client.loop.currentZone.id).toBe(TOWN_ID);
	expect(client.loop.avatar).toEqual(
		expect.objectContaining({
			hp: scenarioAvatar(defeated, player.sessionId).maxHp,
			x: TOWN_SPAWN.x,
			y: TOWN_SPAWN.y,
		}),
	);
	const arrivalGame = currentGame(client.playfield);
	expect(arrivalGame.player.zoneId).toBe(TOWN_ID);
	expect(activeZone(arrivalGame.world, TOWN_ID)).toEqual(
		expect.objectContaining({ monsters: [], projectiles: [] }),
	);
	expect(arrivalGame.events).toEqual([]);
	expect(client.net.sample(client.sampleTime())?.zoneId).toBe(TOWN_ID);
	expect(client.particles.activeCount).toBe(0);

	player.send(scenarioInput({ x: 24, interact: true }));
	stack.advanceTick();
	const reentered = player.take('snapshot');
	expect(reentered.zoneId).toBe(DUNGEON_ID);
	expect(reentered.projectiles).toEqual(entered.projectiles);
	expect(reentered.monsters).toEqual(entered.monsters);
	await client.ingest(reentered);
	expect(client.loop.currentZone.id).toBe(DUNGEON_ID);
	client.net.close();
});

async function clientView(
	welcome: Extract<ServerMessage, { t: 'welcome' }>,
	initial: Extract<ServerMessage, { t: 'snapshot' }>,
	zones: Zone[],
) {
	const renderer = await createTestRenderer(VIEW);
	let now = 0;
	const particles = new ParticleEngine(seededRng(0x428));
	const playfield = new PlayfieldRenderable(renderer.renderer, {
		now: () => now,
		particles,
	});
	const sounds: string[] = [];
	playfield.sound = { play: (kind) => sounds.push(kind) };
	renderer.renderer.root.add(playfield);

	const net = new NetClient('ws://127.0.0.1:1', 'Ember', {
		publicKey: '',
		signChallenge: async () => new Uint8Array(),
	});
	let receivedAt = 10_000;
	net.ingest(welcome, receivedAt);
	net.ingest(initial, receivedAt);
	const byId = new Map(zones.map((zone) => [zone.id, zone]));
	const loop = new GameLoop({
		net,
		input: { poll: () => idle(), consumeInteract: () => false },
		hud: { update: () => {}, syncChat: () => {}, flashLevelUp: () => {} },
		playfield,
		sound: { play: () => {} },
		localZone: (id) => byId.get(id) ?? zones[0],
		weapon: DEFAULT_WEAPON,
		now: () => receivedAt + INTERP_DELAY_MS + 5,
		modalOpen: () => false,
		syncViews: () => {},
	});
	loop.frame(FRAME_MS);
	now += FRAME_MS;
	await renderer.renderOnce();

	return {
		net,
		loop,
		playfield,
		particles,
		sounds,
		sampleTime: () => receivedAt + INTERP_DELAY_MS,
		ingest: async (snapshot: Extract<ServerMessage, { t: 'snapshot' }>) => {
			receivedAt += FRAME_MS;
			net.ingest(snapshot, receivedAt);
			loop.frame(FRAME_MS);
			now += FRAME_MS;
			await renderer.renderOnce();
		},
		renderAgain: async () => {
			now += FRAME_MS;
			await renderer.renderOnce();
		},
	};
}

function currentGame(playfield: PlayfieldRenderable): GameState {
	if (playfield.game === null)
		throw new Error('client did not produce a GameState');
	return playfield.game;
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

function deathZones(): Zone[] {
	const town = scenarioZone(TOWN_ID, 'town', {
		portals: [scenarioPortal(DUNGEON_ID, 24, TOWN_SPAWN.x)],
	});
	const dungeon = scenarioZone(DUNGEON_ID, 'dungeon', {
		monsters: [
			{
				...spawnMonster('chaser', MONSTER_ID, 14, GROUND_TOP - 5),
				speed: 0,
			},
		],
		projectiles: [
			{
				id: 1,
				x: 70,
				y: GROUND_TOP - 3,
				vx: 0,
				vy: 0,
				life: 0.06,
				damage: 0,
				poiseDamage: 0,
				knockback: 0,
				knockbackUp: 0,
			},
		],
		nextProjectileId: 2,
		nextMonsterId: MONSTER_ID + 1,
	});
	return [town, dungeon];
}
