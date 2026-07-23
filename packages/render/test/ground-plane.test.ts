import { expect, test } from 'bun:test';
import type { Entity, Npc } from '@mmo/core/entities';
import { Compositor } from '@mmo/render/compositor';
import {
	actorDepthY,
	npcDepthY,
	paintActor,
	paintNpc,
} from '@mmo/render/sprites';

/**
 * The ground-plane law: every planted actor's deepest ink lands in the TOP half
 * of the row its collision box bottoms out on — the ground's top row when it
 * stands on terrain. Baselines (buddy 1, chaser 0.5, shooter/brute 1,
 * merchant 0.5) exist exactly to make this hold across foot-art idioms, so all
 * five actor kinds share one visual plane.
 */

const NO_CAM = { x: 0, y: 0 };
const W = 24;
const H = 16;

function deepestInkRow(c: Compositor): number {
	const s = c.surface();
	for (let y = s.length - 1; y >= 0; y--)
		if (s[y].some((cell) => cell.char !== ' ')) return y;
	throw new Error('no ink painted');
}

function ent(over: Partial<Entity> & Pick<Entity, 'id' | 'type'>): Entity {
	return {
		x: 8,
		y: 6,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

const MONSTERS = ['chaser', 'shooter', 'brute'] as const;

for (const type of MONSTERS) {
	test(`a ${type}'s deepest ink lands on its box-bottom row`, () => {
		const e = ent({ id: 1, type });
		const c = new Compositor(W, H);
		paintActor(c, e, NO_CAM);
		expect(deepestInkRow(c)).toBe(actorDepthY(e));
	});
}

test("a player's deepest ink lands on its box-bottom row", () => {
	const e = ent({
		id: 1,
		type: 'player',
		cosmetics: { hue: 2, hat: '', nameplate: 0, form: 'buddy' },
	});
	const c = new Compositor(W, H);
	paintActor(c, e, NO_CAM);
	expect(deepestInkRow(c)).toBe(actorDepthY(e));
});

test("the merchant NPC's deepest ink lands on its box-bottom row", () => {
	const npc: Npc = {
		id: 1,
		kind: 'vendor',
		name: 'Mira',
		x: 8,
		y: 6,
		w: 4,
		h: 5,
	};
	const c = new Compositor(W, H);
	paintNpc(c, npc, NO_CAM);
	expect(deepestInkRow(c)).toBe(npcDepthY(npc));
});
