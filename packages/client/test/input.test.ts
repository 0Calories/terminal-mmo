import { expect, test } from 'bun:test';
import { InputState } from '../src/input';

test('clear() releases all held keys so they cannot stick after a mode switch', () => {
	const input = new InputState();
	input.press('d', 0);
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

	input.mouseDown(0); // left button
	expect(input.poll(0).attack).toBe(true);
	expect(input.poll(0).guard).toBe(false);
	input.mouseUp(0);
	expect(input.poll(0).attack).toBe(false);

	// Right button (button 2) raises Guard, not attack.
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
	expect(input.consumeInteract()).toBe(false); // still held: no re-trigger
	expect(input.consumeInteract()).toBe(false);

	// A key-repeat while already held must not re-arm the edge.
	input.press('e', 0);
	expect(input.consumeInteract()).toBe(false);

	// A fresh press after release fires again.
	input.release('e');
	input.press('e', 0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);
});

test('interact is edge-triggered under the mouse scheme too (bound to f) (#261)', () => {
	const input = new InputState('mouse');
	input.press('f', 0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false); // held: no re-trigger
});

test('poll() does NOT consume the interact edge, so a press survives fast polls between slow sends (#261 portal regression)', () => {
	// The render loop polls at up to 120 Hz but reports to the server ~30 Hz. If poll()
	// consumed the edge, ~3 of every 4 presses would be swallowed on a non-send frame
	// and never reach the wire ("portals don't fire"). poll() must leave the edge for
	// consumeInteract(), which the send block calls once per network send.
	const input = new InputState('keyboard');
	input.press('e', 0);
	// Several render polls happen before the next send; none of them eat the edge.
	input.poll(0);
	input.poll(0);
	input.poll(0);
	expect(input.consumeInteract()).toBe(true);
	expect(input.consumeInteract()).toBe(false);
});

test('clear() drops a pending interact edge so it cannot fire after a mode switch (#261)', () => {
	const input = new InputState('keyboard');
	input.press('e', 0);
	input.clear(); // e.g. entering chat typing mode before the edge was consumed
	expect(input.consumeInteract()).toBe(false);
});

test('a fresh press is dropped on the SHORT window without release events (ADR 0024 §5)', () => {
	// A terminal without Kitty key-release reporting never calls release(), so a held
	// key is dropped after its idle window. A first (fresh) press uses the short tier,
	// so a quick tap stops the Avatar promptly (low overshoot).
	const input = new InputState('keyboard');
	input.press('d', 0);
	expect(input.poll(130).moveX).toBe(1); // still held within the short window (140ms)
	expect(input.poll(200).moveX).toBe(0); // dropped past the short window with no release
});

test('a second press within the confirm interval extends the key to the LONG window (ADR 0024 §5)', () => {
	// Auto-repeat: the first press drops on the short window (its ~500ms-delayed second
	// beat has not arrived yet), then a second press within HELD_CONFIRM_MS (600ms)
	// confirms a genuine repeat stream and promotes the key to the long window.
	const input = new InputState('keyboard');
	input.press('d', 0); // fresh press → short window (140ms)
	expect(input.poll(200).moveX).toBe(0); // dropped on the short window, no release reported

	input.press('d', 550); // 550ms later (< 600ms) → confirmed repeat → long window (300ms)
	// 150ms after the second press: past the 140ms short window, but the long window keeps it.
	expect(input.poll(700).moveX).toBe(1);
	expect(input.poll(900).moveX).toBe(0); // finally dropped past the 300ms long window
});

test('after the long window lapses, the next fresh press resets to the SHORT tier (ADR 0024 §5)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0); // short
	input.press('d', 500); // confirmed repeat → long window (300ms)
	expect(input.poll(801).moveX).toBe(0); // 301ms after the last press → long window lapsed

	// A genuinely fresh press long after the drop (> 600ms since the last press) is NOT a
	// repeat, so it starts on the short tier again — proven by dropping past 140ms, not 300ms.
	input.press('d', 2000);
	expect(input.poll(2130).moveX).toBe(1); // within the short window
	expect(input.poll(2200).moveX).toBe(0); // dropped past the short window (would still hold if long)
});

test('a key dropped from the long tier resets to SHORT even if re-pressed within the confirm interval (ADR 0024 §5, #227 criterion 3)', () => {
	// The reset is drop-based, not merely timer-based: once the long window lapses and
	// the poll drops the key, its auto-repeat stream is considered ended. A re-press that
	// still falls inside the 600ms confirm interval (350ms after the last press here) is
	// therefore a FRESH press on the short tier, not a re-promotion to long.
	const input = new InputState('keyboard');
	input.press('d', 0); // short
	input.press('d', 500); // confirmed repeat → long window (300ms)
	expect(input.poll(801).moveX).toBe(0); // 301ms later: long window lapsed, stream forgotten

	input.press('d', 850); // 350ms after the last press (< 600ms) but the stream had ended
	expect(input.poll(980).moveX).toBe(1); // within the short window (850 + 140)
	expect(input.poll(1000).moveX).toBe(0); // dropped past the short window (would still hold if long)
});

test('a sustained auto-repeat stream stays held across gaps longer than the short window (ADR 0024 §5)', () => {
	// Once promoted to the long window, repeats arriving within it keep refreshing the key,
	// so an irregular auto-repeat stream never drops mid-walk.
	const input = new InputState('keyboard');
	input.press('d', 0); // short
	input.press('d', 500); // → long window
	expect(input.poll(700).moveX).toBe(1); // held (200ms gap < 300ms long window)
	input.press('d', 750); // next repeat refreshes
	expect(input.poll(1000).moveX).toBe(1); // still held (250ms gap < 300ms)
	input.press('d', 1050);
	expect(input.poll(1300).moveX).toBe(1); // still walking
});

test('a reported release disables the timeout fallback (held keys persist)', () => {
	const input = new InputState('keyboard');
	input.press('d', 0);
	input.release('a'); // any release proves the terminal reports releases
	input.press('d', 0);
	expect(input.poll(10_000).moveX).toBe(1); // never auto-dropped once release-capable
});
