import { expect, test } from 'bun:test';
import { BOX, type Entity, type Npc } from '@mmo/core/entities';
import {
	type ActorCategory,
	compareActorDepth,
	type DepthKey,
	sortActorsByDepth,
} from '@mmo/render/scene';
import { actorFootDepth, npcFootDepth } from '@mmo/render/sprites';

function key(footY: number, category: ActorCategory, id: number): DepthKey {
	return { footY, category, id };
}

function order<T extends DepthKey & { tag: string }>(
	items: readonly T[],
): string[] {
	return sortActorsByDepth(items).map((i) => i.tag);
}

function monster(over: Partial<Entity> & Pick<Entity, 'id'>): Entity {
	return {
		type: 'chaser',
		x: 0,
		y: 0,
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

test('the crowd sorts back-to-front by foot depth: a forward actor draws after a rear one', () => {
	const rear = { ...key(10, 'monster', 1), tag: 'rear' };
	const front = { ...key(20, 'monster', 2), tag: 'front' };
	// Nearer-the-front feet (larger world-y) draw later, on top.
	expect(order([front, rear])).toEqual(['rear', 'front']);
});

test('foot depth, not raw y, decides order when baselines differ', () => {
	// Two actors share the same box y but plant feet at different depths (a
	// non-zero baseline lowers the feet). The deeper-footed one draws in front.
	const shallow = { ...key(15, 'avatar', 1), tag: 'shallow' };
	const deep = { ...key(16, 'avatar', 2), tag: 'deep' };
	expect(order([deep, shallow])).toEqual(['shallow', 'deep']);
});

test('at equal foot depth, NPCs stay behind monsters and remote avatars', () => {
	const npc = { ...key(12, 'npc', 9), tag: 'npc' };
	const mon = { ...key(12, 'monster', 1), tag: 'monster' };
	const av = { ...key(12, 'avatar', 1), tag: 'avatar' };
	// Earlier in the drawn order == further back. NPC first, then monster, then avatar.
	expect(order([av, mon, npc])).toEqual(['npc', 'monster', 'avatar']);
});

test('equal depth and category resolve by stable id, deterministically', () => {
	const a = { ...key(12, 'monster', 3), tag: 'id3' };
	const b = { ...key(12, 'monster', 7), tag: 'id7' };
	const c = { ...key(12, 'monster', 5), tag: 'id5' };
	expect(order([b, a, c])).toEqual(['id3', 'id5', 'id7']);
	// Same input in any order yields the same draw order — no frame-to-frame flicker.
	expect(order([c, b, a])).toEqual(['id3', 'id5', 'id7']);
});

test('ordering is total and input-order-independent across all keys', () => {
	const items = [
		{ ...key(20, 'avatar', 2), tag: 'a' },
		{ ...key(12, 'npc', 9), tag: 'b' },
		{ ...key(12, 'monster', 1), tag: 'c' },
		{ ...key(20, 'avatar', 1), tag: 'd' },
		{ ...key(12, 'monster', 4), tag: 'e' },
	];
	const forward = order(items);
	const reversed = order([...items].reverse());
	expect(reversed).toEqual(forward);
	expect(forward).toEqual(['b', 'c', 'e', 'd', 'a']);
});

test('sortActorsByDepth does not mutate its input', () => {
	const items = [
		{ ...key(20, 'monster', 2), tag: 'x' },
		{ ...key(10, 'monster', 1), tag: 'y' },
	];
	const before = items.map((i) => i.tag);
	sortActorsByDepth(items);
	expect(items.map((i) => i.tag)).toEqual(before);
});

test('compareActorDepth is a consistent comparator (antisymmetric)', () => {
	const a = key(12, 'monster', 1);
	const b = key(12, 'avatar', 1);
	expect(Math.sign(compareActorDepth(a, b))).toBe(
		-Math.sign(compareActorDepth(b, a)),
	);
});

test('actorFootDepth plants feet at the box bottom shifted by the body baseline', () => {
	// The default player Form (buddy) carries baseline 1, so the same box y plants
	// a player one row deeper than a baseline-0 monster — raw y would tie them.
	const player = monster({ id: 1, type: 'player', y: 4 });
	const mon = monster({ id: 2, type: 'chaser', y: 4 });
	expect(actorFootDepth(mon)).toBe(4 + BOX.h);
	expect(actorFootDepth(player)).toBe(4 + BOX.h + 1);
	expect(actorFootDepth(player)).toBeGreaterThan(actorFootDepth(mon));
});

test('npcFootDepth plants feet at the NPC box bottom', () => {
	const npc: Npc = {
		id: 1,
		kind: 'vendor',
		name: 'Mira',
		x: 3,
		y: 8,
		w: 4,
		h: 5,
	};
	expect(npcFootDepth(npc)).toBe(8 + 5);
});
