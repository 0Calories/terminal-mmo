import { expect, test } from 'bun:test';
import { createGameFromZones, loadZones } from '@mmo/shared';
import { followCam, playSceneOf, playStatusLine } from '../src/play';

function townGame() {
	const zones = loadZones();
	const field = zones.find((z) => z.type === 'field');
	if (!field) throw new Error('expected an authored field Zone');
	return { game: createGameFromZones(zones, field.id), zone: field };
}

test('playSceneOf exposes the active Zone as a renderable scene', () => {
	const { game, zone } = townGame();
	const scene = playSceneOf(game);
	expect(scene.terrain).toBe(zone.terrain);
	expect(scene.portals).toBe(zone.portals);
	// Monsters are the simulated entities; the Player is drawn on top, not here.
	expect(scene.entities).toBe(game.world.zones[game.player.zoneId].monsters);
	expect(scene.npcs).toEqual(zone.npcs ?? []);
});

test('followCam centres the Player and clamps to the grid', () => {
	// Player mid-grid: camera centres so the Player sits near the viewport middle.
	const c = followCam(100, 50, 240, 80, 40, 20);
	expect(c.x).toBeGreaterThan(0);
	expect(c.x).toBeLessThanOrEqual(240 - 40);
	// Far-left Player: camera clamps to 0 (no blank space scrolls in).
	expect(followCam(0, 0, 240, 80, 40, 20).x).toBe(0);
	// Far-right Player: camera clamps to grid - viewport.
	expect(followCam(240, 0, 240, 80, 40, 20).x).toBe(240 - 40);
	// Grid smaller than the viewport: pinned at 0.
	expect(followCam(5, 5, 20, 10, 40, 20)).toEqual({ x: 0, y: 0 });
});

test('playStatusLine reports the Zone id and Player vitals', () => {
	const { game, zone } = townGame();
	const line = playStatusLine(game);
	expect(line).toContain(zone.id);
	expect(line).toContain('hp');
	expect(line).toContain('lv');
});
