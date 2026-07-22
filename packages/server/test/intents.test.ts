import { expect, test } from 'bun:test';
import type { AvatarIntent } from '@mmo/core/zones';
import { foldPendingEdges } from '../src/intents';

function held(sessionId: number): AvatarIntent {
	return {
		sessionId,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		attack: false,
		interact: false,
	};
}

test('a queued interact edge folds onto exactly one tick, then is consumed', () => {
	const intents = new Map([[7, held(7)]]);
	const pendingEmotes = new Map<number, string>();
	const pendingInteract = new Set<number>([7]);

	const t1 = foldPendingEdges(intents.values(), pendingEmotes, pendingInteract);
	expect(t1[0].interact).toBe(true);
	expect(pendingInteract.has(7)).toBe(false);

	const t2 = foldPendingEdges(intents.values(), pendingEmotes, pendingInteract);
	expect(t2[0].interact).toBe(false);
});

test('emote and interact edges fold together, each consumed once', () => {
	const intents = new Map([[7, held(7)]]);
	const pendingEmotes = new Map<number, string>([[7, 'test-emote']]);
	const pendingInteract = new Set<number>([7]);

	const [out] = foldPendingEdges(
		intents.values(),
		pendingEmotes,
		pendingInteract,
	);
	expect(out.emote).toBe('test-emote');
	expect(out.interact).toBe(true);
	expect(pendingEmotes.has(7)).toBe(false);
	expect(pendingInteract.has(7)).toBe(false);
});

test('one session’s edge never leaks onto another session', () => {
	const intents = new Map([
		[7, held(7)],
		[8, held(8)],
	]);
	const out = foldPendingEdges(
		intents.values(),
		new Map(),
		new Set<number>([8]),
	);
	const byId = new Map(out.map((i) => [i.sessionId, i]));
	expect(byId.get(8)?.interact).toBe(true);
	expect(byId.get(7)?.interact).toBe(false);
});
