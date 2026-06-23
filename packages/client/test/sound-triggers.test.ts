import { expect, test } from 'bun:test';
import { jumpStarted } from '../src/sound/triggers';

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
