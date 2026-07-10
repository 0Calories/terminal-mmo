import type { Input } from '@mmo/core/entities';

// No key-release events on non-Kitty terminals: promote a key's idle window short→long once auto-repeat confirms, so taps stay crisp and walks survive repeat gaps.
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
	private heldWindowMs = new Map<Action, number>();
	private releaseCapable = false;
	private mouseAttack = false;
	private mouseGuard = false;
	// Edge-triggered: latched on the rising edge, read once per network send (not poll) so a fast poll can't swallow or re-fire it.
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
		if (a === 'interact' && !this.held.has('interact'))
			this.interactEdge = true;
		const last = this.seen.get(a);
		const isRepeat = last !== undefined && now - last <= HELD_CONFIRM_MS;
		this.heldWindowMs.set(a, isRepeat ? HELD_LONG_MS : HELD_SHORT_MS);
		this.held.add(a);
		this.seen.set(a, now);
	}

	release(name: string) {
		this.releaseCapable = true;
		const a = this.actionFor(name);
		if (a) this.held.delete(a);
	}

	mouseDown(button: number) {
		if (button === 0) this.mouseAttack = true;
		else if (button === 2) this.mouseGuard = true;
	}

	mouseUp(button: number) {
		if (button === 0) this.mouseAttack = false;
		else if (button === 2) this.mouseGuard = false;
	}

	clear() {
		this.held.clear();
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
					if (win === HELD_LONG_MS) {
						this.seen.delete(a);
						this.heldWindowMs.delete(a);
					}
				}
			}
		}
		const moveX =
			(this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
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

	consumeInteract(): boolean {
		const fired = this.interactEdge;
		this.interactEdge = false;
		return fired;
	}
}
