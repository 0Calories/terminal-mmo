import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import type { GameState, Input, Portal, Zone } from '../../src';
import { activeZone, BOX, GROUND_TOP, spawnAvatar, step } from '../../src';
import { createGame, flatTerrain } from '../helpers';

const INTERACT: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	interact: true,
};

function portalGame(): GameState {
	const y = GROUND_TOP - BOX.h;
	const portal: Portal = {
		x: 20,
		y,
		w: BOX.w,
		h: BOX.h,
		target: 'town-01',
		arrival: { x: 50, y },
	};
	const field: Zone = {
		id: 'field-01',
		type: 'field',
		terrain: flatTerrain(),
		monsters: [],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		nextMonsterId: 2,
		portals: [portal],
	};
	const town = loadZones().find((z) => z.id === 'town-01');
	if (!town) throw new Error('town-01 missing from authored zones/');
	return {
		player: {
			avatar: spawnAvatar(20, y),
			progress: { level: 3, xp: 17, gold: 42 },
			inventory: [],
			zoneId: field.id,
			log: [],
			nextId: 1,
			rngState: 1,
		},
		world: { zones: { [field.id]: field, [town.id]: town }, tick: 0 },
	};
}

test('entering a Portal switches the active Zone and repositions the Avatar', () => {
	const g = step(portalGame(), INTERACT, 16);
	expect(g.player.zoneId).toBe('town-01');
	expect(g.player.avatar.x).toBe(50);
	expect(g.player.avatar.y).toBe(GROUND_TOP - BOX.h);
});

test('persistent state (progress + inventory) survives a Portal transition', () => {
	const before = portalGame();
	before.player.inventory = [
		{ id: 7, base: 'sword', slot: 'weapon', rarity: 'rare', affixes: [] },
	];
	const g = step(before, INTERACT, 16);
	expect(g.player.progress).toEqual({ level: 3, xp: 17, gold: 42 });
	expect(g.player.inventory).toEqual(before.player.inventory);
});

test('no transition without the interact intent, even while on a Portal', () => {
	const g = step(portalGame(), { moveX: 0, jump: false, attack: false }, 16);
	expect(g.player.zoneId).toBe('field-01');
});

test('no transition when the Avatar is not overlapping a Portal', () => {
	const game = portalGame();
	game.player.avatar.x = 80;
	const g = step(game, INTERACT, 16);
	expect(g.player.zoneId).toBe('field-01');
});

test('createGame wires a round-trip Portal pair: Town -> Field -> Town', () => {
	let g = createGame();
	const townPortal = activeZone(g.world, 'town-01').portals[0];
	const fieldPortal = activeZone(g.world, 'field-01').portals[0];
	expect(g.world.zones[townPortal.target].type).toBe('field');
	expect(g.world.zones[fieldPortal.target].type).toBe('town');

	expect(g.player.zoneId).toBe('town-01');
	g.player.avatar.x = townPortal.x;
	g = step(g, INTERACT, 16);
	expect(g.player.zoneId).toBe('field-01');
	expect(g.player.avatar.x).toBe(townPortal.arrival.x);

	g.player.avatar.x = fieldPortal.x;
	g = step(g, INTERACT, 16);
	expect(g.player.zoneId).toBe('town-01');
	expect(g.player.avatar.x).toBe(fieldPortal.arrival.x);
});

test('a Portal transition is deterministic', () => {
	const run = () => {
		let g = createGame(7);
		g.player.avatar.x = activeZone(g.world, 'field-01').portals[0].x;
		g = step(g, INTERACT, 16);
		return g;
	};
	const a = run();
	const b = run();
	expect(b.player.zoneId).toBe(a.player.zoneId);
	expect(b.player.avatar.x).toBe(a.player.avatar.x);
	expect(b.player.avatar.y).toBe(a.player.avatar.y);
});
