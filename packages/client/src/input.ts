import type { Input } from '@mmo/shared';

// Fallback timeout for terminals without Kitty key-release reporting: without
// release events a held key would stick, so it's dropped after this idle (M0).
const HELD_MS = 220;

// The abstract action set bindings resolve onto (ADR 0017 §12). Dodge stays reserved
// for the mobility slice; this slice adds the contextual vertical attack modifiers
// `up` / `down` (the Launcher / Spike inputs, ADR 0017 §6) and moves jump to `space`
// only so `up` is free as the launcher modifier.
type Action =
	| 'left'
	| 'right'
	| 'jump'
	| 'up'
	| 'down'
	| 'attack'
	| 'guard'
	| 'interact'
	| 'skill1'
	| 'skill2';

// The two control schemes (ADR 0017 §12). Both map onto the SAME abstract actions,
// so a poll() yields identical Input intents whichever the Player runs.
export type Scheme = 'keyboard' | 'mouse';

// Keyboard-only: attack on `j` (and the legacy `x`), Guard on `k` (ADR 0017 §5/§12 —
// `l` stays reserved for the later Dodge verb), active skills on `u`/`i`. `e` interacts.
// Jump is `space` ONLY now (ADR 0017 §12): the arrow `up`/`down` keys (and `w`/`s`) are
// the contextual vertical attack modifiers — `up`+attack Launches, `down`+attack Spikes.
const KEYBOARD_BINDINGS: Readonly<Record<string, Action>> = {
	left: 'left',
	a: 'left',
	right: 'right',
	d: 'right',
	space: 'jump',
	up: 'up',
	w: 'up',
	down: 'down',
	s: 'down',
	j: 'attack',
	x: 'attack',
	k: 'guard',
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
	space: 'jump',
	up: 'up',
	w: 'up',
	down: 'down',
	s: 'down',
	k: 'guard',
	f: 'interact',
	e: 'skill1',
	r: 'skill2',
};

export class InputState {
	private held = new Set<Action>();
	private seen = new Map<Action, number>();
	private releaseCapable = false;
	// Left mouse button held (keyboard+mouse scheme attack, ADR 0017 §12). Tracked
	// apart from `held` because mouse releases are always reported, so it needs no
	// held-key timeout fallback and is OR'd into the attack intent in poll().
	private mouseAttack = false;
	// Right mouse button held (keyboard+mouse scheme Guard, ADR 0017 §5/§12). Tracked
	// apart from `held` for the same reason as `mouseAttack` (mouse releases are always
	// reported) and OR'd into the guard intent in poll().
	private mouseGuard = false;
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
		this.mouseAttack = false;
		this.mouseGuard = false;
	}

	poll(now: number): Input {
		if (!this.releaseCapable) {
			for (const a of [...this.held])
				if (now - (this.seen.get(a) ?? 0) > HELD_MS) this.held.delete(a);
		}
		const moveX =
			(this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
		return {
			moveX: moveX as -1 | 0 | 1,
			jump: this.held.has('jump'),
			attack: this.held.has('attack') || this.mouseAttack,
			guard: this.held.has('guard') || this.mouseGuard,
			// Contextual vertical attack modifiers (ADR 0017 §6): OR'd with attack by the
			// combo gate to pick Launcher / Spike. They are also movement-neutral here —
			// `up`/`down` no longer jump, so a held modifier doesn't move the Avatar.
			up: this.held.has('up'),
			down: this.held.has('down'),
			interact: this.held.has('interact'),
			skill: this.held.has('skill1')
				? 1
				: this.held.has('skill2')
					? 2
					: undefined,
		};
	}
}
