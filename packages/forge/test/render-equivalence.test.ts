import { expect, test } from 'bun:test';
import { type Entity, spawnMonster, type Terrain } from '@mmo/core/entities';
import type { ZoneScene } from '@mmo/render';
import { Compositor } from '@mmo/render/compositor';
import { drawNameplates, drawPortals, drawTerrain } from '@mmo/render/scene';
import { paintActor } from '@mmo/render/sprites';
import { composeZone } from '../src/render/zone-compose';

const W = 20;
const H = 12;

function groundTerrain(): Terrain {
	const cells = new Uint8Array(W * H);
	for (let x = 0; x < W; x++) cells[(H - 1) * W + x] = 1;
	return { w: W, h: H, cells };
}

function scene(monster: Entity): ZoneScene {
	return {
		terrain: groundTerrain(),
		portals: [],
		npcs: [],
		entities: [monster],
	};
}

// A Sprite scene must compose to the same terminal cells no matter which
// consumer draws it (ADR 0038). Forge's preview/playtest `composeZone` and a
// direct compose through the production `@mmo/render/scene` + `sprites`
// functions the live client uses must agree cell-for-cell.
test('Forge preview composes a scene to the same cells as the production passes', () => {
	const monster = spawnMonster('chaser', 1, 6, H - 2);
	monster.onGround = true;
	const cam = { x: 0, y: 0 };

	const forge = new Compositor(W, H);
	composeZone(forge, scene(monster), cam);

	const live = new Compositor(W, H);
	live.clear();
	drawTerrain(live, groundTerrain(), cam);
	drawPortals(live, [], cam);
	paintActor(live, monster, cam);
	drawNameplates(live, [monster], cam);

	expect(forge.surface()).toEqual(live.surface());
});

test('a monster renders as non-empty cells over the composed ground', () => {
	const monster = spawnMonster('chaser', 1, 6, H - 2);
	monster.onGround = true;
	const compositor = new Compositor(W, H);
	composeZone(compositor, scene(monster), { x: 0, y: 0 });
	const inked = compositor
		.surface()
		.flat()
		.filter((cell) => cell.char !== ' ');
	expect(inked.length).toBeGreaterThan(0);
});
