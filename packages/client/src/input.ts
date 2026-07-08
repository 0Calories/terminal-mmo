import type { Input } from '@mmo/shared';

// Adaptive two-tier held-key window for terminals WITHOUT Kitty key-release
// reporting (ADR 0024 §5). With no release events a held key is OS auto-repeat
// (~500ms initial delay, then synthesised repeats). One fixed idle timeout can't
// serve both a crisp tap-stop and a stable sustained walk, so we split it:
//   - HELD_SHORT_MS on a key's FIRST press — quick to drop, so taps stay crisp.
//   - promoted to HELD_LONG_MS once a SECOND press within HELD_CONFIRM_MS confirms
//     a genuine auto-repeat stream, so a walk survives irregular repeat gaps.
// A long-tier drop forgets the key's timestamp, so the next press starts short
// again. Bypassed entirely once the terminal reports any release (`releaseCapable`).
const HELD_SHORT_MS = 140;
const HELD_LONG_MS = 300;
const HELD_CONFIRM_MS = 600;

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

// Both schemes map onto the SAME abstract actions, so poll() yields identical Input
// intents whichever the Player runs (ADR 0017 §12).
export type Scheme = 'keyboard' | 'mouse';

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

// Attack/Guard are the mouse buttons (see `mouseDown`), freeing `e`/`r` for skills; since
// `e` is now skill1, interact relocates to `f` so portals/vendors stay reachable. Movement
// + jump are shared with the keyboard scheme, so the intents match.
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
	// Per-key held window in force, chosen at press time. Only consulted on the
	// non-Kitty (`!releaseCapable`) path in poll().
	private heldWindowMs = new Map<Action, number>();
	private releaseCapable = false;
	// Tracked apart from `held`: mouse releases are always reported, so these need no
	// timeout fallback. OR'd into the attack/guard intents in poll().
	private mouseAttack = false;
	private mouseGuard = false;
	// Edge-triggered: one physical press yields exactly one true read, not one per held
	// tick (#261) — else standing on a Portal would re-fire the transition every frame.
	// Consumed by `consumeInteract()` at the network SEND cadence, NOT `poll()`: the loop
	// polls up to 120 Hz but sends ~30 Hz, so a poll-consumed edge would be dropped on
	// ~3 of every 4 frames and never reach the wire.
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
		// A press within HELD_CONFIRM_MS of this key's prior press confirms an auto-repeat
		// → long window; else a fresh press → short. The timestamp survives a short-window
		// drop, so the ~500ms-delayed second repeat still confirms (ADR 0024 §5).
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

	// Left-click attacks, right-click Guards (keyboard+mouse scheme, ADR 0017 §12).
	// OpenTUI fires these alongside held movement keys, so a click while running still acts.
	mouseDown(button: number) {
		if (button === 0) this.mouseAttack = true;
		else if (button === 2) this.mouseGuard = true;
	}

	mouseUp(button: number) {
		if (button === 0) this.mouseAttack = false;
		else if (button === 2) this.mouseGuard = false;
	}

	// Drop every held input when handing control to a modal (chat), so a key held at the
	// switch can't stay "down" and move/attack on return.
	clear() {
		this.held.clear();
		// Drop per-key window/timestamp too, so a press right after control returns starts
		// fresh on the short tier rather than falsely confirming a repeat against a stale
		// timestamp.
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
					// A LONG-tier drop means the auto-repeat stream ended, so forget the
					// timestamp — the next press starts short again. A SHORT-tier drop KEEPS
					// it so the ~500ms-delayed second repeat can still confirm the stream
					// (ADR 0024 §5 / #227).
					if (win === HELD_LONG_MS) {
						this.seen.delete(a);
						this.heldWindowMs.delete(a);
					}
				}
			}
		}
		const moveX =
			(this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
		// `interact` is absent here: latched on the rising edge and read once at the send
		// cadence via `consumeInteract()`, so a fast poll can't swallow a press.
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

	// Read and clear the latched interact edge, once per network send (see `interactEdge`).
	// The caller must NOT call this while a modal owns the keyboard, so a press latched
	// just before a menu opens can't fire a Portal from under it.
	consumeInteract(): boolean {
		const fired = this.interactEdge;
		this.interactEdge = false;
		return fired;
	}
}
