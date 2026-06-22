import { expect, test } from 'bun:test';
import { InputState } from '../src/input';

test('clear() releases all held keys so they cannot stick after a mode switch', () => {
	const input = new InputState();
	input.press('d', 0); // moving right
	expect(input.poll(0).moveX).toBe(1);
	input.clear(); // e.g. entering chat typing mode
	expect(input.poll(0).moveX).toBe(0);
});

test('k fires skill slot 1, l fires skill slot 2', () => {
	const input = new InputState();
	expect(input.poll(0).skill).toBeUndefined();

	input.press('k', 0);
	expect(input.poll(0).skill).toBe(1);
	input.release('k');

	input.press('l', 0);
	expect(input.poll(0).skill).toBe(2);
});
