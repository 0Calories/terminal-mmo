import { describe, expect, it } from 'bun:test';
import { parseZone } from '@mmo/shared';
import { clampPreviewCam, sceneOf } from '../src/preview';

// A minimal field: 10 wide, floor on the bottom row, one chaser spawn + a portal.
const CATALOGS = {
	monsters: [{ id: 'slime', behavior: 'chaser' as const, name: 'Slime' }],
	npcs: [],
};
const ZONE_TEXT = `{"type":"field","spawns":{"c":"slime"},"portals":{"P":{"target":"t","arrival":[2,8]}}}
---
..........
..........
..........
....c.....
..........
..P.......
..........
..........
##########`;

describe('clampPreviewCam', () => {
	it('clamps the camera within [0, gridDim - view]', () => {
		// Grid 100x40, viewport 30x20 → max scroll (70, 20).
		expect(clampPreviewCam({ x: -5, y: -5 }, 100, 40, 30, 20)).toEqual({
			x: 0,
			y: 0,
		});
		expect(clampPreviewCam({ x: 999, y: 999 }, 100, 40, 30, 20)).toEqual({
			x: 70,
			y: 20,
		});
		expect(clampPreviewCam({ x: 12, y: 7 }, 100, 40, 30, 20)).toEqual({
			x: 12,
			y: 7,
		});
	});

	it('pins to 0 when the grid is smaller than the viewport', () => {
		expect(clampPreviewCam({ x: 4, y: 4 }, 10, 9, 80, 24)).toEqual({
			x: 0,
			y: 0,
		});
	});
});

describe('sceneOf', () => {
	const zone = parseZone(ZONE_TEXT, CATALOGS, 'f');
	const scene = sceneOf(zone);

	it('exposes the Zone terrain, portals, and spawned monsters as a static scene', () => {
		expect(scene.terrain).toBe(zone.terrain);
		expect(scene.portals).toBe(zone.portals);
		expect(scene.entities).toBe(zone.monsters);
		expect(scene.entities.length).toBe(1);
	});

	it('defaults npcs to an empty list when the Zone has none', () => {
		expect(scene.npcs).toEqual([]);
	});
});
