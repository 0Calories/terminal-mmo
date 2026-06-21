import { expect, test } from 'bun:test';
import { InputState } from '../src/input';

test('clear() releases all held keys so they cannot stick after a mode switch', () => {
	const input = new InputState();
	input.press('d', 0); // moving right
	expect(input.poll(0).moveX).toBe(1);
	input.clear(); // e.g. entering chat typing mode
	expect(input.poll(0).moveX).toBe(0);
});
