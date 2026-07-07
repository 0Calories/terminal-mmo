import { expect, test } from 'bun:test';
import type { AvatarIntent } from '@mmo/shared';
import { foldPendingEdges } from '../src/intents';

// A minimal reported intent for a session holding still, interact NOT on the sticky
// flag (it rides the pending-edge set, ADR 0027).
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

test('a queued interact edge folds onto exactly ONE tick, then is gone (ADR 0027 portal-once)', () => {
	const intents = new Map([[7, held(7)]]);
	const pendingEmotes = new Map<number, string>();
	const pendingInteract = new Set<number>([7]); // one press arrived since last tick

	// Tick 1: the edge fires...
	const t1 = foldPendingEdges(intents.values(), pendingEmotes, pendingInteract);
	expect(t1[0].interact).toBe(true);
	// ...and is consumed, so it can't re-fire even though the reused intent persists.
	expect(pendingInteract.has(7)).toBe(false);

	// Tick 2 (and beyond): no edge queued → interact stays false. This is what stops the
	// overlapping Portal arrival (#90) from ping-ponging.
	const t2 = foldPendingEdges(intents.values(), pendingEmotes, pendingInteract);
	expect(t2[0].interact).toBe(false);
});

test('a session with no queued edge is returned untouched (same object)', () => {
	const i = held(7);
	const [out] = foldPendingEdges(
		new Map([[7, i]]).values(),
		new Map(),
		new Set(),
	);
	expect(out).toBe(i); // no allocation when nothing to fold
});

test('emote and interact edges fold together, each consumed once', () => {
	const intents = new Map([[7, held(7)]]);
	const pendingEmotes = new Map<number, string>([[7, 'wave']]);
	const pendingInteract = new Set<number>([7]);

	const [out] = foldPendingEdges(
		intents.values(),
		pendingEmotes,
		pendingInteract,
	);
	expect(out.emote).toBe('wave');
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
		new Set<number>([8]), // only session 8 pressed
	);
	const byId = new Map(out.map((i) => [i.sessionId, i]));
	expect(byId.get(8)?.interact).toBe(true);
	expect(byId.get(7)?.interact).toBe(false);
});
