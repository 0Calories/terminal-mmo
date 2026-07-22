import { expect, test } from 'bun:test';
import { InputState } from '../src/input/movement';

test('keyboard and mouse schemes produce the same gameplay intent', () => {
	const keyboard = new InputState('keyboard');
	const mouse = new InputState('mouse');

	for (const input of [keyboard, mouse]) {
		input.press('d', 0);
		input.press('space', 0);
		input.press('l', 0);
	}
	keyboard.press('j', 0);
	keyboard.press('u', 0);
	mouse.mouseDown(0);
	mouse.press('e', 0);

	expect(keyboard.poll(0)).toEqual(mouse.poll(0));
	expect(keyboard.poll(0)).toEqual({
		moveX: 1,
		jump: true,
		attack: true,
		dodge: true,
		guard: false,
		skill: 1,
	});
});

test('Dodge and Guard remain distinct across keyboard and mouse inputs', () => {
	for (const scheme of ['keyboard', 'mouse'] as const) {
		const dodge = new InputState(scheme);
		dodge.press('l', 0);
		expect(dodge.poll(0)).toEqual(
			expect.objectContaining({ dodge: true, guard: false }),
		);

		const guard = new InputState(scheme);
		guard.press('k', 0);
		expect(guard.poll(0)).toEqual(
			expect.objectContaining({ dodge: false, guard: true }),
		);
	}

	const rightClick = new InputState('mouse');
	rightClick.mouseDown(2);
	expect(rightClick.poll(0)).toEqual(
		expect.objectContaining({ attack: false, guard: true }),
	);
});

test('clearing input releases keyboard, mouse, and pending Interact state', () => {
	const input = new InputState('mouse');
	input.press('d', 0);
	input.mouseDown(0);
	input.mouseDown(2);
	input.press('f', 0);
	input.clear();

	expect(input.poll(0)).toEqual(
		expect.objectContaining({ moveX: 0, attack: false, guard: false }),
	);
	expect(input.consumeInteract()).toBe(false);
});

test.each([
	['keyboard', 'e'],
	['mouse', 'f'],
] as const)('%s Interact is a durable edge consumed exactly once', (scheme, key) => {
	const input = new InputState(scheme);
	input.press(key, 0);
	input.poll(0);
	input.poll(0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);

	input.press(key, 1);
	expect(input.consumeInteract()).toBe(false);
	input.release(key);
	input.press(key, 2);
	expect(input.consumeInteract()).toBe(true);
});

test('unconfirmed key presses expire, while auto-repeat extends the hold window', () => {
	const fresh = new InputState('keyboard');
	fresh.press('d', 0);
	expect(fresh.poll(130).moveX).toBe(1);
	expect(fresh.poll(200).moveX).toBe(0);

	const repeated = new InputState('keyboard');
	repeated.press('d', 0);
	repeated.press('d', 500);
	expect(repeated.poll(700).moveX).toBe(1);
	repeated.press('d', 750);
	expect(repeated.poll(1_000).moveX).toBe(1);
});

test('an expired repeat tier restarts with the short confirmation window', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.press('d', 500);
	expect(input.poll(801).moveX).toBe(0);

	input.press('d', 850);
	expect(input.poll(980).moveX).toBe(1);
	expect(input.poll(1_000).moveX).toBe(0);
});

test('reported key releases disable timeout fallback for held keys', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.release('a');
	input.press('d', 0);
	expect(input.poll(10_000).moveX).toBe(1);
});
