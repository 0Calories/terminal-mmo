import type { Input } from '@mmo/shared';

// Adaptive two-tier held-key window for terminals WITHOUT Kitty key-release
// reporting (ADR 0024 §5). With no release events, "holding" a key is really OS
// auto-repeat: a ~500ms initial delay, then a stream of synthesised repeats. A
// single fixed idle timeout is a compromise between two goals that pull apart —
// short enough that a quick tap stops the Avatar promptly (low overshoot), yet
// long enough that a sustained walk survives irregular auto-repeat gaps. We split
// it into two tiers instead:
//
//   - HELD_SHORT_MS is applied on a key's FIRST press. Quicker to drop than the
//     old fixed 220ms, so taps and releases are crisp for tight platforming/combat.
//   - Once a SECOND press of the same key arrives within HELD_CONFIRM_MS of the
//     prior press (confirming a genuine auto-repeat stream, not a tap), that key's
//     window is promoted to the longer HELD_LONG_MS so sustained walking stays
//     solid across irregular repeat gaps.
//
// A key's tier is decided per press from its last-press timestamp. When a key is
// finally dropped from the long tier (its window lapses with no refresh) that
// timestamp is forgotten, so the next press is fresh and starts on the short tier
// again — the auto-repeat stream has demonstrably ended.
//
// Starting values to be tuned interactively in a real non-Kitty terminal (tuning
// points, not contract). The whole mechanism is bypassed the moment the terminal
// reports any key-release (`releaseCapable`), so Kitty terminals are unaffected.
const HELD_SHORT_MS = 140;
const HELD_LONG_MS = 300;
const HELD_CONFIRM_MS = 600;

// The abstract action set bindings resolve onto (ADR 0017 §12). `down` is reserved for
// the later combo slice; this slice adds both `dodge` (the i-frame hop) and `guard` (the
// unified directional defense) to movement, jump, attack, interact, and the two skill slots.
type Action =
	| 'left'
	| 'right'
	| 'jump'
	| 'attack'
	| 'dodge'
	| 'guard'
	| 'interact'
	| 'skill1'
	| 'skill2';

// The two control schemes (ADR 0017 §12). Both map onto the SAME abstract actions,
// so a poll() yields identical Input intents whichever the Player runs.
export type Scheme = 'keyboard' | 'mouse';

// Keyboard-only: attack on `j` (and the legacy `x`), Guard on `k`, Dodge on `l` (ADR 0017
// §5/§12), active skills on `u`/`i`. `e` interacts.
const KEYBOARD_BINDINGS: Readonly<Record<string, Action>> = {
	left: 'left',
	a: 'left',
	right: 'right',
	d: 'right',
	up: 'jump',
	space: 'jump',
	j: 'attack',
	x: 'attack',
	k: 'guard',
	l: 'dodge',
	e: 'interact',
	u: 'skill1',
	i: 'skill2',
};

// Keyboard + mouse: attack is the left mouse button, Guard the right (see `mouseDown`);
// active skills move to `e`/`r`. Since `e` is now skill1, interact relocates to `f` so
// portals / vendors stay reachable. `k` still raises Guard from the keyboard too (shared
// binding). Movement + jump are shared with the keyboard scheme, so the intents are
// identical. Mouse-position aim is stubbed (reserved for ranged Classes).
const MOUSE_BINDINGS: Readonly<Record<string, Action>> = {
	left: 'left',
	a: 'left',
	right: 'right',
	d: 'right',
	up: 'jump',
	space: 'jump',
	k: 'guard',
	l: 'dodge',
	f: 'interact',
	e: 'skill1',
	r: 'skill2',
};

export class InputState {
	private held = new Set<Action>();
	private seen = new Map<Action, number>();
	// Per-key held-key window in ms currently in force, chosen at press time: the
	// short tier for a fresh press, the long tier once an auto-repeat stream is
	// confirmed (see HELD_SHORT_MS / HELD_LONG_MS). Only consulted on the non-Kitty
	// (`!releaseCapable`) path in poll().
	private heldWindowMs = new Map<Action, number>();
	private releaseCapable = false;
	// Left mouse button held (keyboard+mouse scheme attack, ADR 0017 §12). Tracked
	// apart from `held` because mouse releases are always reported, so it needs no
	// held-key timeout fallback and is OR'd into the attack intent in poll().
	private mouseAttack = false;
	// Right mouse button held (keyboard+mouse scheme Guard, ADR 0017 §5/§12). Tracked
	// apart from `held` for the same reason as `mouseAttack` (mouse releases are always
	// reported) and OR'd into the guard intent in poll().
	private mouseGuard = false;
	// `interact` is edge-triggered: a single physical press yields exactly one true
	// read, not one per held tick (#261). Without this, standing on a Portal whose
	// arrival point overlaps it would re-trigger the transition every frame, and any
	// held-key interaction (the merchant) would fire repeatedly. Set on the rising
	// edge of the bound key (press while not already held). Consumed by
	// `consumeInteract()` at the network SEND cadence — NOT by `poll()`: the render
	// loop polls at up to 120 Hz but only reports to the server ~30 Hz, so a
	// poll-consumed edge would be discarded on ~3 of every 4 frames and the press
	// would never reach the wire (the "portals don't fire" regression, #261 fallout).
	private interactEdge = false;
	private readonly bindings: Readonly<Record<string, Action>>;

	constructor(scheme: Scheme = 'keyboard') {
		this.bindings = scheme === 'mouse' ? MOUSE_BINDINGS : KEYBOARD_BINDINGS;
	}

	private actionFor(name: string): Action | null {
		return this.bindings[name] ?? null;
	}

	press(name: string, now: number) {
		const a = this.actionFor(name);
		if (!a) return;
		// Rising edge only: a key-repeat while already held must not re-arm interact.
		if (a === 'interact' && !this.held.has('interact'))
			this.interactEdge = true;
		// Two-tier window (ADR 0024 §5): a press within HELD_CONFIRM_MS of this key's
		// prior press is a confirmed auto-repeat, so promote it to the long window;
		// otherwise it's a fresh press on the short window. The last-press timestamp
		// survives a short-window drop, so the ~500ms-delayed second auto-repeat still
		// confirms; a genuinely fresh press (long after the key was dropped) falls
		// outside the confirm interval and resets to the short tier.
		const last = this.seen.get(a);
		const isRepeat = last !== undefined && now - last <= HELD_CONFIRM_MS;
		this.heldWindowMs.set(a, isRepeat ? HELD_LONG_MS : HELD_SHORT_MS);
		this.held.add(a);
		this.seen.set(a, now);
	}

	release(name: string) {
		this.releaseCapable = true; // terminal reports releases — drop the timeout fallback
		const a = this.actionFor(name);
		if (a) this.held.delete(a);
	}

	// Left-click (button 0) is attack and right-click (button 2) is Guard in the
	// keyboard+mouse scheme (ADR 0017 §5/§12). OpenTUI fires these alongside held
	// movement keys (verified in the Forge editor), so a click while running still acts.
	mouseDown(button: number) {
		if (button === 0) this.mouseAttack = true;
		else if (button === 2) this.mouseGuard = true;
	}

	mouseUp(button: number) {
		if (button === 0) this.mouseAttack = false;
		else if (button === 2) this.mouseGuard = false;
	}

	// Drop every held input. Used when handing control to a modal (chat typing) so a
	// key/button held at the switch can't stay "down" and move/attack on return.
	clear() {
		this.held.clear();
		// Drop per-key window/timestamp state too, so a press right after control
		// returns (e.g. leaving chat) starts fresh on the short tier rather than
		// falsely confirming an auto-repeat against a pre-switch timestamp.
		this.seen.clear();
		this.heldWindowMs.clear();
		this.mouseAttack = false;
		this.mouseGuard = false;
		this.interactEdge = false;
	}

	poll(now: number): Input {
		if (!this.releaseCapable) {
			for (const a of [...this.held]) {
				const win = this.heldWindowMs.get(a) ?? HELD_SHORT_MS;
				if (now - (this.seen.get(a) ?? 0) > win) {
					this.held.delete(a);
					// A drop from the LONG tier means the auto-repeat stream ended (no
					// refresh arrived within the long window), so forget the key's
					// timestamp: the next press is then a fresh press on the SHORT tier
					// again (ADR 0024 §5 / #227 criterion 3). A SHORT-tier drop KEEPS the
					// timestamp so the ~500ms-delayed second auto-repeat beat can still
					// confirm the stream and promote this key to the long window.
					if (win === HELD_LONG_MS) {
						this.seen.delete(a);
						this.heldWindowMs.delete(a);
					}
				}
			}
		}
		const moveX =
			(this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
		// `interact` is deliberately absent here: it is latched on the rising edge and
		// read once at the send cadence via `consumeInteract()`, so a fast poll can't
		// swallow a press between two slower network sends.
		return {
			moveX: moveX as -1 | 0 | 1,
			jump: this.held.has('jump'),
			attack: this.held.has('attack') || this.mouseAttack,
			dodge: this.held.has('dodge'),
			guard: this.held.has('guard') || this.mouseGuard,
			skill: this.held.has('skill1')
				? 1
				: this.held.has('skill2')
					? 2
					: undefined,
		};
	}

	// Read and clear the latched interact edge. Called once per network send (not per
	// render frame) so a single press survives the poll/send cadence gap and reaches
	// the server exactly once (see `interactEdge`). Returns false when no press is
	// pending; the caller must NOT call this while a modal owns the keyboard, so a
	// press latched just before opening a menu can't fire a Portal from under it.
	consumeInteract(): boolean {
		const fired = this.interactEdge;
		this.interactEdge = false;
		return fired;
	}
}
