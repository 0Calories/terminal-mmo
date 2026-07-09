import { expect, test } from 'bun:test';
import { jumpStarted, landed, leveledUp } from '../src/sound/triggers';

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

test('landed fires on the frame an airborne Avatar touches the ground', () => {
	expect(landed({ onGround: false }, { onGround: true })).toBe(true);
});

test('landed does not fire while still airborne', () => {
	expect(landed({ onGround: false }, { onGround: false })).toBe(false);
});

test('landed does not fire while staying grounded (no re-trigger)', () => {
	expect(landed({ onGround: true }, { onGround: true })).toBe(false);
});

test('landed does not fire on the take-off frame', () => {
	expect(landed({ onGround: true }, { onGround: false })).toBe(false);
});

test('leveledUp fires on the edge the level increases', () => {
	expect(leveledUp(1, 2)).toBe(true);
});

test('leveledUp fires once for a multi-level jump', () => {
	expect(leveledUp(3, 6)).toBe(true);
});

test('leveledUp is silent when the level is unchanged', () => {
	expect(leveledUp(4, 4)).toBe(false);
});

test('leveledUp is silent when the level drops', () => {
	expect(leveledUp(5, 1)).toBe(false);
});
