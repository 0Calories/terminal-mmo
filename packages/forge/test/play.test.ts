import { expect, test } from 'bun:test';
import { loadZones } from '@mmo/assets';
import { createLocalWorld, localAvatar } from '@mmo/core/world';
import { followCam, playSceneOf, playStatusLine } from '../src/play';

function fieldWorld() {
	const zones = loadZones();
	const field = zones.find((z) => z.type === 'field');
	if (!field) throw new Error('expected an authored field Zone');
	return { lw: createLocalWorld(zones, field.id), zone: field };
}

test('createLocalWorld boots the played Zone on the real server world', () => {
	const { lw, zone } = fieldWorld();
	expect(localAvatar(lw)?.avatar.type).toBe('player');
	expect(lw.world.startZone).toBe(zone.id);
});

test('playSceneOf exposes the active Zone as a renderable scene', () => {
	const { lw, zone } = fieldWorld();
	const scene = playSceneOf(lw);
	expect(scene.terrain).toBe(zone.terrain);
	expect(scene.portals).toBe(zone.portals);
	expect(scene.entities).toBe(zone.monsters);
	expect(scene.npcs).toEqual(zone.npcs ?? []);
});

test('followCam centres the Player and clamps to the grid', () => {
	const c = followCam(100, 50, 240, 80, 40, 20);
	expect(c.x).toBeGreaterThan(0);
	expect(c.x).toBeLessThanOrEqual(240 - 40);
	expect(followCam(0, 0, 240, 80, 40, 20).x).toBe(0);
	expect(followCam(240, 0, 240, 80, 40, 20).x).toBe(240 - 40);
	expect(followCam(5, 5, 20, 10, 40, 20)).toEqual({ x: 0, y: 0 });
});

test('playStatusLine reports the Zone id and Player vitals', () => {
	const { lw, zone } = fieldWorld();
	const line = playStatusLine(lw);
	expect(line).toContain(zone.id);
	expect(line).toContain('hp');
	expect(line).toContain('lv');
});
