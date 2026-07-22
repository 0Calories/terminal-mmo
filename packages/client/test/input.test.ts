import { expect, test } from 'bun:test';
import { InputState } from '../src/input/movement';

test('clear() releases all held keys so they cannot stick after a mode switch', () => {
	const input = new InputState();
	input.press('d', 0);
	expect(input.poll(0).moveX).toBe(1);
	input.clear();
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

test('keyboard scheme: l is Dodge, k is Guard — distinct verbs (ADR 0017 §5/§12)', () => {
	const input = new InputState('keyboard');
	expect(input.poll(0).dodge).toBe(false);
	expect(input.poll(0).guard).toBe(false);

	input.press('l', 0);
	let polled = input.poll(0);
	expect(polled.dodge).toBe(true);
	expect(polled.guard).toBe(false);
	expect(polled.skill).toBeUndefined();
	input.release('l');
	expect(input.poll(0).dodge).toBe(false);

	input.press('k', 0);
	polled = input.poll(0);
	expect(polled.guard).toBe(true);
	expect(polled.dodge).toBe(false);
	expect(polled.attack).toBe(false);
	expect(polled.skill).toBeUndefined();
	input.release('k');
	expect(input.poll(0).guard).toBe(false);
});

test('mouse scheme: l also maps to Dodge (shared keyboard binding)', () => {
	const input = new InputState('mouse');
	input.press('l', 0);
	expect(input.poll(0).dodge).toBe(true);
});

test('mouse scheme: left-click attacks, right-click guards, e/r fire skill slots (ADR 0017 §5/§12)', () => {
	const input = new InputState('mouse');

	input.mouseDown(0);
	expect(input.poll(0).attack).toBe(true);
	expect(input.poll(0).guard).toBe(false);
	input.mouseUp(0);
	expect(input.poll(0).attack).toBe(false);

	input.mouseDown(2);
	const g = input.poll(0);
	expect(g.guard).toBe(true);
	expect(g.attack).toBe(false);
	input.mouseUp(2);
	expect(input.poll(0).guard).toBe(false);

	input.press('e', 0);
	expect(input.poll(0).skill).toBe(1);
	input.release('e');

	input.press('r', 0);
	expect(input.poll(0).skill).toBe(2);
});

test('k also raises Guard in the mouse scheme (shared keyboard binding)', () => {
	const input = new InputState('mouse');
	input.press('k', 0);
	expect(input.poll(0).guard).toBe(true);
});

test('clear() drops a held right-click Guard so it cannot stick across a mode switch', () => {
	const input = new InputState('mouse');
	input.mouseDown(2);
	expect(input.poll(0).guard).toBe(true);
	input.clear();
	expect(input.poll(0).guard).toBe(false);
});

test('both schemes map their bindings to identical intents', () => {
	const kb = new InputState('keyboard');
	const ms = new InputState('mouse');

	kb.press('d', 0);
	kb.press('space', 0);
	ms.press('d', 0);
	ms.press('space', 0);
	kb.press('j', 0);
	ms.mouseDown(0);
	kb.press('u', 0);
	ms.press('e', 0);

	const a = kb.poll(0);
	const b = ms.poll(0);
	expect(a).toEqual(b);
	expect(a).toEqual({
		moveX: 1,
		jump: true,
		attack: true,
		dodge: false,
		guard: false,
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

test('interact is edge-triggered: one press yields exactly one consume, not one per held tick (#261)', () => {
	const input = new InputState('keyboard');
	expect(input.consumeInteract()).toBe(false);

	input.press('e', 0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);
	expect(input.consumeInteract()).toBe(false);

	input.press('e', 0);
	expect(input.consumeInteract()).toBe(false);

	input.release('e');
	input.press('e', 0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);
});

test('interact is edge-triggered under the mouse scheme too (bound to f) (#261)', () => {
	const input = new InputState('mouse');
	input.press('f', 0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);
});

test('poll() does NOT consume the interact edge, so a press survives fast polls between slow sends (#261 portal regression)', () => {
	const input = new InputState('keyboard');
	input.press('e', 0);
	input.poll(0);
	input.poll(0);
	input.poll(0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);
});

test('clear() drops a pending interact edge so it cannot fire after a mode switch (#261)', () => {
	const input = new InputState('keyboard');
	input.press('e', 0);
	input.clear();
	expect(input.consumeInteract()).toBe(false);
});

test('a fresh press is dropped on the SHORT window without release events (ADR 0024 §5)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	expect(input.poll(130).moveX).toBe(1);
	expect(input.poll(200).moveX).toBe(0);
});

test('a second press within the confirm interval extends the key to the LONG window (ADR 0024 §5)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	expect(input.poll(200).moveX).toBe(0);

	input.press('d', 550);
	expect(input.poll(700).moveX).toBe(1);
	expect(input.poll(900).moveX).toBe(0);
});

test('after the long window lapses, the next fresh press resets to the SHORT tier (ADR 0024 §5)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.press('d', 500);
	expect(input.poll(801).moveX).toBe(0);

	input.press('d', 2000);
	expect(input.poll(2130).moveX).toBe(1);
	expect(input.poll(2200).moveX).toBe(0);
});

test('a key dropped from the long tier resets to SHORT even if re-pressed within the confirm interval (ADR 0024 §5, #227 criterion 3)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.press('d', 500);
	expect(input.poll(801).moveX).toBe(0);

	input.press('d', 850);
	expect(input.poll(980).moveX).toBe(1);
	expect(input.poll(1000).moveX).toBe(0);
});

test('a sustained auto-repeat stream stays held across gaps longer than the short window (ADR 0024 §5)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.press('d', 500);
	expect(input.poll(700).moveX).toBe(1);
	input.press('d', 750);
	expect(input.poll(1000).moveX).toBe(1);
	input.press('d', 1050);
	expect(input.poll(1300).moveX).toBe(1);
});

test('a reported release disables the timeout fallback (held keys persist)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.release('a');
	input.press('d', 0);
	expect(input.poll(10_000).moveX).toBe(1);
});
