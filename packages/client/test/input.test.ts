import { expect, test } from 'bun:test';
import { InputState } from '../src/input';

test('clear() releases all held keys so they cannot stick after a mode switch', () => {
	const input = new InputState();
	input.press('d', 0); // moving right
	expect(input.poll(0).moveX).toBe(1);
	input.clear(); // e.g. entering chat typing mode
	expect(input.poll(0).moveX).toBe(0);
});

test('keyboard scheme: j attacks, u/i fire skill slots 1/2 (ADR 0017 §12)', () => {
	const input = new InputState('keyboard');
	expect(input.poll(0).attack).toBe(false);
	expect(input.poll(0).skill).toBeUndefined();

	input.press('j', 0);
	expect(input.poll(0).attack).toBe(true);
	input.release('j');

	input.press('u', 0);
	expect(input.poll(0).skill).toBe(1);
	input.release('u');

	input.press('i', 0);
	expect(input.poll(0).skill).toBe(2);
});

test('keyboard scheme: legacy k/l no longer fire skills (freed for Guard/Dodge)', () => {
	const input = new InputState('keyboard');
	input.press('k', 0);
	input.press('l', 0);
	expect(input.poll(0).skill).toBeUndefined();
});

test('mouse scheme: left-click attacks, e/r fire skill slots 1/2 (ADR 0017 §12)', () => {
	const input = new InputState('mouse');

	input.mouseDown(0); // left button
	expect(input.poll(0).attack).toBe(true);
	input.mouseUp(0);
	expect(input.poll(0).attack).toBe(false);

	// A non-left button (right = Guard, reserved) is not an attack.
	input.mouseDown(2);
	expect(input.poll(0).attack).toBe(false);
	input.mouseUp(2);

	input.press('e', 0);
	expect(input.poll(0).skill).toBe(1);
	input.release('e');

	input.press('r', 0);
	expect(input.poll(0).skill).toBe(2);
});

test('both schemes map their bindings to identical intents', () => {
	const kb = new InputState('keyboard');
	const ms = new InputState('mouse');

	// Movement + jump are shared, so the same physical keys yield the same intent.
	kb.press('d', 0);
	kb.press('space', 0);
	ms.press('d', 0);
	ms.press('space', 0);
	// Attack via each scheme's primary binding…
	kb.press('j', 0);
	ms.mouseDown(0);
	// …and skill slot 1 via each scheme's binding.
	kb.press('u', 0);
	ms.press('e', 0);

	const a = kb.poll(0);
	const b = ms.poll(0);
	expect(a).toEqual(b);
	expect(a).toEqual({
		moveX: 1,
		jump: true,
		attack: true,
		interact: false,
		skill: 1,
	});
});

test('mouse attack is dropped on clear() (no stuck button after a mode switch)', () => {
	const input = new InputState('mouse');
	input.mouseDown(0);
	expect(input.poll(0).attack).toBe(true);
	input.clear();
	expect(input.poll(0).attack).toBe(false);
});

test('the 220ms held-key timeout still drops a stuck key without release events', () => {
	// A terminal without Kitty key-release reporting never calls release(), so a held
	// key is dropped after the idle timeout (degraded but playable, ADR 0017 §11).
	const input = new InputState('keyboard');
	input.press('d', 0);
	expect(input.poll(100).moveX).toBe(1); // still held within the window
	expect(input.poll(300).moveX).toBe(0); // dropped after 220ms with no release
});

test('a reported release disables the timeout fallback (held keys persist)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.release('a'); // any release proves the terminal reports releases
	input.press('d', 0);
	expect(input.poll(10_000).moveX).toBe(1); // never auto-dropped once release-capable
});
