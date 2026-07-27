import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { loadAssetEntries, registerDerivedBoxes } from '@mmo/assets';
import { combatEventAt, entityBox, meleeHitbox } from '../../src/combat/combat';
import { spawnProjectile } from '../../src/combat/projectile';
import { BOX } from '../../src/entities/body';
import {
	type BoxDims,
	boxOf,
	clearSpriteBoxes,
	npcBoxOf,
	registerSpriteBoxes,
} from '../../src/entities/boxes';
import { spawnMonster } from '../../src/entities/factory';
import type { Entity, Terrain } from '../../src/entities/types';
import { IDLE_DRIVE, stepEntity } from '../../src/physics/physics';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '../../src/sprites/meta';
import { GROUND_TOP } from '../../src/zones/constants';
import { flatTerrain } from '../helpers';

function stepUntilGrounded(t: Terrain, e0: Entity): Entity {
	let e = e0;
	for (let i = 0; i < 200 && !e.onGround; i++)
		e = stepEntity(t, e, IDLE_DRIVE, 1 / 30).e;
	return e;
}

const SLIME_BOX = { w: 7, h: 4 } as const;
const BRUTE_BOX = { w: 7, h: 6 } as const;

function registerFixtures(): void {
	registerSpriteBoxes({
		monsters: new Map<string, BoxDims>([
			[MONSTER_SPRITE_REF.slime, SLIME_BOX],
			[MONSTER_SPRITE_REF.brute, BRUTE_BOX],
		]),
		npcs: new Map([[NPC_SPRITE_REF.vendor, { w: 6, h: 5 }]]),
	});
}

// The suite preload registers the real derived boxes; these laws own the
// registry for their duration and hand the real ones back when done.
beforeEach(() => clearSpriteBoxes());
afterAll(() => registerDerivedBoxes(loadAssetEntries()));

describe('boxOf', () => {
	test('defaults to the uniform BOX before registration', () => {
		expect(boxOf('slime')).toEqual({ w: BOX.w, h: BOX.h });
		expect(boxOf(undefined)).toBe(BOX);
	});

	test('serves the registered derived box per monster type', () => {
		registerFixtures();
		expect(boxOf('slime')).toEqual(SLIME_BOX);
		expect(boxOf('brute')).toEqual(BRUTE_BOX);
		expect(boxOf('chaser')).toEqual({ w: BOX.w, h: BOX.h });
	});

	test('the Avatar box is canonical: no registration can move it', () => {
		registerSpriteBoxes({
			monsters: new Map([
				['player', { w: 9, h: 9 }],
				['buddy', { w: 9, h: 9 }],
			]),
		});
		expect(boxOf('player')).toBe(BOX);
	});

	test('degenerate dims are refused', () => {
		registerSpriteBoxes({
			monsters: new Map([[MONSTER_SPRITE_REF.slime, { w: 0, h: 4 }]]),
		});
		expect(boxOf('slime')).toEqual({ w: BOX.w, h: BOX.h });
	});

	test('npcBoxOf falls back to the authored NPC slot', () => {
		expect(npcBoxOf('vendor')).toEqual({ w: 4, h: BOX.h });
		registerFixtures();
		expect(npcBoxOf('vendor')).toEqual({ w: 6, h: 5 });
	});
});

describe('spawn and physics with derived boxes', () => {
	test('spawnMonster centres the derived box in the authored slot, feet on its floor', () => {
		registerFixtures();
		const slotX = 20;
		const slotY = GROUND_TOP - BOX.h;
		const slime = spawnMonster('slime', 1, slotX, slotY);
		expect(slime.y + SLIME_BOX.h).toBe(slotY + BOX.h);
		expect(slime.x).toBe(slotX + Math.floor((BOX.w - SLIME_BOX.w) / 2));
		const brute = spawnMonster('brute', 2, slotX, slotY);
		expect(brute.y + BRUTE_BOX.h).toBe(slotY + BOX.h);
	});

	test('a spawned monster rests with feet exactly on the ground, not sunk or floating', () => {
		registerFixtures();
		const t = flatTerrain();
		for (const type of ['slime', 'brute'] as const) {
			const m = spawnMonster(type, 1, 20, GROUND_TOP - BOX.h);
			const settled = stepUntilGrounded(t, m);
			expect(settled.y + boxOf(type).h).toBe(GROUND_TOP);
			expect(settled.onGround).toBe(true);
		}
	});
});

describe('combat geometry with derived boxes', () => {
	test('entityBox is the derived hurtbox', () => {
		registerFixtures();
		const m = spawnMonster('slime', 1, 20, GROUND_TOP - BOX.h);
		expect(entityBox(m)).toEqual({ x: m.x, y: m.y, w: 7, h: 4 });
	});

	test('meleeHitbox anchors on the attacker box but keeps its authored reach', () => {
		registerFixtures();
		const brute = spawnMonster('brute', 1, 20, GROUND_TOP - BOX.h);
		const hb = meleeHitbox(brute);
		const uniform = meleeHitbox({ x: brute.x, y: brute.y, facing: 1 });
		expect(hb.x).toBe(brute.x + BRUTE_BOX.w);
		expect(hb.h).toBe(BRUTE_BOX.h);
		expect(hb.w).toBe(uniform.w);
	});

	test('combat events land on the per-entity box centre', () => {
		registerFixtures();
		const m = spawnMonster('slime', 7, 20, GROUND_TOP - BOX.h);
		const e = combatEventAt('hit', m, 1, 3);
		expect(e.x).toBe(m.x + SLIME_BOX.w / 2);
		expect(e.y).toBe(m.y + SLIME_BOX.h / 2);
	});

	test('a projectile leaves from the shooter box edge, vertically centred on it', () => {
		registerSpriteBoxes({
			monsters: new Map([[MONSTER_SPRITE_REF.shooter, { w: 7, h: 5 }]]),
		});
		const shooter = spawnMonster('shooter', 1, 20, GROUND_TOP - BOX.h);
		const shot = spawnProjectile(9, shooter, 1, {
			speed: 30,
			life: 2,
			damage: 1,
			poiseDamage: 1,
			knockback: 1,
			knockbackUp: 1,
		});
		expect(shot.x).toBe(shooter.x + 7);
	});
});
