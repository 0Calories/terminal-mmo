import { expect, test } from 'bun:test';
import {
	isMenuBlipKey,
	jumpStarted,
	landed,
	leveledUp,
} from '../src/sound/triggers';

test('fires on the frame an Avatar leaves the ground moving upward', () => {
	expect(jumpStarted({ onGround: true }, { onGround: false, vy: -34 })).toBe(
		true,
	);
});

test('does not fire while grounded', () => {
	expect(jumpStarted({ onGround: true }, { onGround: true, vy: 0 })).toBe(
		false,
	);
});

test('does not fire while already airborne (no re-trigger mid-jump)', () => {
	expect(jumpStarted({ onGround: false }, { onGround: false, vy: -10 })).toBe(
		false,
	);
});

test('walking off a ledge (downward/zero vy) makes no jump sound', () => {
	expect(jumpStarted({ onGround: true }, { onGround: false, vy: 0 })).toBe(
		false,
	);
	expect(jumpStarted({ onGround: true }, { onGround: false, vy: 5 })).toBe(
		false,
	);
});

// --- land ------------------------------------------------------------------

test('landed fires on the frame an airborne Avatar touches the ground', () => {
	expect(landed({ onGround: false }, { onGround: true })).toBe(true);
});

test('landed does not fire while still airborne', () => {
	expect(landed({ onGround: false }, { onGround: false })).toBe(false);
});

test('landed does not fire while staying grounded (no re-trigger)', () => {
	expect(landed({ onGround: true }, { onGround: true })).toBe(false);
});

// The take-off frame is a jump, not a landing — they are opposite edges.
test('landed does not fire on the take-off frame', () => {
	expect(landed({ onGround: true }, { onGround: false })).toBe(false);
});

// --- level-up --------------------------------------------------------------

test('leveledUp fires on the edge the level increases', () => {
	expect(leveledUp(1, 2)).toBe(true);
});

// A multi-level jump in one snapshot is still a single rising edge — the flourish
// plays once, not once per intermediate level (no overlapping replays).
test('leveledUp fires once for a multi-level jump', () => {
	expect(leveledUp(3, 6)).toBe(true);
});

test('leveledUp is silent when the level is unchanged', () => {
	expect(leveledUp(4, 4)).toBe(false);
});

// Defensive: a level that somehow drops (respawn snapshot ordering, reconnect)
// must never play the flourish.
test('leveledUp is silent when the level drops', () => {
	expect(leveledUp(5, 1)).toBe(false);
});

// --- UI blip ---------------------------------------------------------------

test('directional + confirm menu keys produce a blip', () => {
	for (const k of ['up', 'down', 'left', 'right', 'return'])
		expect(isMenuBlipKey(k)).toBe(true);
});

// Close / cancel and any non-navigation key are silent — the blip marks movement
// through a menu, not every keystroke.
test('close and unrelated keys produce no blip', () => {
	for (const k of ['escape', 'e', 'o', 'q', 'a', ''])
		expect(isMenuBlipKey(k)).toBe(false);
});
