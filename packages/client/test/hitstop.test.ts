import { expect, test } from 'bun:test';
import {
	HITSTOP_MS,
	isFrozen,
	NO_HITSTOP,
	stepHitstop,
	triggerHitstop,
} from '../src/game/hitstop';

test('hitstop freezes on trigger and drains to unfrozen over its duration', () => {
	expect(isFrozen(NO_HITSTOP)).toBe(false);
	let h = triggerHitstop(NO_HITSTOP);
	expect(isFrozen(h)).toBe(true);
	h = stepHitstop(h, HITSTOP_MS);
	expect(isFrozen(h)).toBe(false);
});

test('a re-trigger mid-freeze cannot shorten the remaining freeze', () => {
	let h = triggerHitstop(NO_HITSTOP, 100);
	h = stepHitstop(h, 30);
	h = triggerHitstop(h, 50);
	expect(h.remainingMs).toBe(70);
});
