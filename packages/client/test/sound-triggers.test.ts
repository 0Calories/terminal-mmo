import { expect, test } from 'bun:test';
import { jumpStarted, landed, leveledUp } from '../src/sound/triggers';

test('movement and progression sounds fire only on their gameplay transitions', () => {
	const jumps = [
		[{ onGround: true }, { onGround: false, vy: -34 }, true],
		[{ onGround: true }, { onGround: true, vy: 0 }, false],
		[{ onGround: false }, { onGround: false, vy: -10 }, false],
		[{ onGround: true }, { onGround: false, vy: 0 }, false],
		[{ onGround: true }, { onGround: false, vy: 5 }, false],
	] as const;
	for (const [before, after, expected] of jumps)
		expect(jumpStarted(before, after)).toBe(expected);

	for (const [wasGrounded, isGrounded, expected] of [
		[false, true, true],
		[false, false, false],
		[true, true, false],
		[true, false, false],
	] as const)
		expect(landed({ onGround: wasGrounded }, { onGround: isGrounded })).toBe(
			expected,
		);

	for (const [before, after, expected] of [
		[1, 2, true],
		[3, 6, true],
		[4, 4, false],
		[5, 1, false],
	] as const)
		expect(leveledUp(before, after)).toBe(expected);
});
