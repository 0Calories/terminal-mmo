import { expect, test } from 'bun:test';
import type { GameKeyDeps, Key, LobbyKeyDeps } from '../src/input/ui-keys';
import {
	gameKeyHandler,
	isHelpKey,
	isMenuBlipKey,
	lobbyKeyHandler,
} from '../src/input/ui-keys';

function key(name: string, sequence = name): Key {
	return { name, sequence, ctrl: false, meta: false, preventDefault: () => {} };
}

function overlay(open = false) {
	return {
		open,
		hidden: 0,
		shown: 0,
		hide(this: { open: boolean; hidden: number }) {
			this.open = false;
			this.hidden++;
		},
		show(this: { open: boolean; shown: number }) {
			this.open = true;
			this.shown++;
		},
	};
}

interface Trace {
	calls: string[];
	deps: GameKeyDeps;
	shop: ReturnType<typeof overlay> & { mode: 'sell' | 'buy' };
	controls: ReturnType<typeof overlay>;
	options: ReturnType<typeof overlay>;
	recustomize: ReturnType<typeof overlay> | null;
	notice: { open: boolean };
	hud: { chatOpen: boolean };
}

const EMPTY_VIEW = {
	inventory: [],
	progress: { level: 1, xp: 0, gold: 0 },
};

function harness(over: Partial<GameKeyDeps> = {}): Trace {
	const calls: string[] = [];
	const log =
		(name: string) =>
		(...args: unknown[]) => {
			calls.push(args.length ? `${name}:${args.join(',')}` : name);
		};

	const notice = { open: false };
	const hud = {
		chatOpen: false,
		openChat: () => {
			calls.push('openChat');
		},
		closeChat: () => {
			calls.push('closeChat');
		},
	};
	const controls = overlay();
	const options = overlay();
	const shop = Object.assign(overlay(), { mode: 'sell' as 'sell' | 'buy' });
	const t: Trace = {
		calls,
		notice,
		hud,
		controls,
		options,
		shop,
		recustomize: null,
		deps: undefined as unknown as GameKeyDeps,
	};

	t.deps = {
		scheme: 'keyboard',
		interactKey: 'e',
		noKittyNotice: notice,
		dismissNoKittyNotice: log('dismissNotice'),
		hud,
		options: Object.assign(options, { key: log('optionsKey') }),
		controls: Object.assign(controls, {
			show: (level: number) => calls.push(`controlsShow:${level}`),
		}),
		shop: Object.assign(shop, {
			count: () => 0,
			switchTab: log('switchTab'),
			move: log('shopMove'),
			update: log('shopUpdate'),
		}),
		shopView: () => EMPTY_VIEW,
		buySelected: log('buy'),
		sellSelected: log('sell'),
		openShop: log('openShop'),
		merchantUnder: () => false,
		recustomize: () => t.recustomize,
		submitRecustomize: (k: Key) => calls.push(`submitRecustomize:${k.name}`),
		openRecustomize: log('openRecustomize'),
		inTown: () => true,
		level: () => 7,
		notice: log('notice'),
		toggleMute: log('toggleMute'),
		blip: log('blip'),
		clearHeldKeys: log('clearHeld'),
		pressMovement: log('press'),
		quit: log('quit'),
		...over,
	};
	return t;
}

test('? is recognised by name or by raw sequence', () => {
	expect(isHelpKey({ name: '?' })).toBe(true);
	expect(isHelpKey({ name: 'unknown', sequence: '?' })).toBe(true);
	expect(isHelpKey({ name: 'a', sequence: 'a' })).toBe(false);
});

test('directional + confirm menu keys produce a blip', () => {
	for (const k of ['up', 'down', 'left', 'right', 'return'])
		expect(isMenuBlipKey(k)).toBe(true);
});

test('close and unrelated keys produce no blip', () => {
	for (const k of ['escape', 'e', 'o', 'q', 'a', ''])
		expect(isMenuBlipKey(k)).toBe(false);
});

function lobby(over: Partial<LobbyKeyDeps> = {}) {
	const calls: string[] = [];
	const notice = { open: false };
	const deps: LobbyKeyDeps = {
		noKittyNotice: notice,
		dismissNoKittyNotice: () => calls.push('dismiss'),
		creating: () => false,
		submitCreator: () => calls.push('submit'),
		blip: () => calls.push('blip'),
		quit: () => calls.push('quit'),
		...over,
	};
	return { calls, notice, handle: lobbyKeyHandler(deps) };
}

test('lobby: any key dismisses the no-Kitty notice and nothing else', () => {
	const l = lobby({ creating: () => true });
	l.notice.open = true;
	l.handle(key('j'));
	expect(l.calls).toEqual(['dismiss']);
});

test('lobby: q quits while waiting on the server', () => {
	const l = lobby();
	l.handle(key('q'));
	expect(l.calls).toEqual(['quit']);
});

test('lobby: keys are inert while waiting on the server', () => {
	const l = lobby();
	l.handle(key('j'));
	expect(l.calls).toEqual([]);
});

test('lobby: q reaches the creator rather than quitting once it is up', () => {
	const l = lobby({ creating: () => true });
	l.handle(key('q'));
	expect(l.calls).toEqual(['submit']);
});

test('lobby: a menu key blips before reaching the creator', () => {
	const l = lobby({ creating: () => true });
	l.handle(key('down'));
	expect(l.calls).toEqual(['blip', 'submit']);
});

test('the no-Kitty notice swallows every key', () => {
	const t = harness();
	t.notice.open = true;
	gameKeyHandler(t.deps)(key('q'));
	expect(t.calls).toEqual(['dismissNotice']);
});

test('an open chat line swallows keys, and escape closes it', () => {
	const t = harness();
	t.hud.chatOpen = true;
	const handle = gameKeyHandler(t.deps);
	handle(key('q'));
	expect(t.calls).toEqual([]);
	handle(key('escape'));
	expect(t.calls).toEqual(['closeChat']);
});

test('the audio options consume keys before any other overlay', () => {
	const t = harness();
	t.options.open = true;
	gameKeyHandler(t.deps)(key('m'));
	expect(t.calls).toEqual(['optionsKey:m']);
});

test('the controls overlay closes on ? or escape and swallows the rest', () => {
	const t = harness();
	t.controls.open = true;
	const handle = gameKeyHandler(t.deps);
	handle(key('j'));
	expect(t.controls.open).toBe(true);
	handle(key('?'));
	expect(t.controls.open).toBe(false);
});

test('m toggles mute when no overlay is up', () => {
	const t = harness();
	gameKeyHandler(t.deps)(key('m'));
	expect(t.calls).toEqual(['toggleMute']);
});

test('shop: return buys in the buy tab and sells in the sell tab', () => {
	const t = harness();
	t.shop.open = true;
	t.shop.mode = 'buy';
	gameKeyHandler(t.deps)(key('return'));
	expect(t.calls).toContain('buy');

	const u = harness();
	u.shop.open = true;
	u.shop.mode = 'sell';
	gameKeyHandler(u.deps)(key('return'));
	expect(u.calls).toContain('sell');
});

test('shop: the interact key closes it, mirroring escape', () => {
	const t = harness();
	t.shop.open = true;
	gameKeyHandler(t.deps)(key('e'));
	expect(t.shop.open).toBe(false);
});

test('the recustomize modal takes escape itself and forwards everything else', () => {
	const t = harness();
	t.recustomize = overlay(true);
	const handle = gameKeyHandler(t.deps);
	handle(key('j'));
	expect(t.calls).toEqual(['submitRecustomize:j']);
	handle(key('escape'));
	expect(t.recustomize.open).toBe(false);
});

test('q quits, and only an overlay that consumes keys can shield it', () => {
	const t = harness();
	gameKeyHandler(t.deps)(key('q'));
	expect(t.calls[0]).toBe('quit');

	const chat = harness();
	chat.hud.chatOpen = true;
	gameKeyHandler(chat.deps)(key('q'));
	expect(chat.calls).toEqual([]);
});

test('? opens the controls at the current level', () => {
	const t = harness();
	gameKeyHandler(t.deps)(key('?'));
	expect(t.calls).toEqual(['controlsShow:7']);
});

test('c re-customizes in Town', () => {
	const t = harness();
	gameKeyHandler(t.deps)(key('c'));
	expect(t.calls).toEqual(['openRecustomize']);
});

test('c outside Town explains itself instead', () => {
	const t = harness({ inTown: () => false });
	gameKeyHandler(t.deps)(key('c'));
	expect(t.calls).toEqual(['notice:Re-customize in Town.']);
});

test('enter opens chat, consumes itself, and drops held movement keys', () => {
	const t = harness();
	let prevented = false;
	const k = key('return');
	k.preventDefault = () => {
		prevented = true;
	};
	gameKeyHandler(t.deps)(k);
	expect(prevented).toBe(true);
	expect(t.calls).toEqual(['openChat', 'clearHeld']);
});

test('the interact key opens the shop only when a merchant is underfoot', () => {
	const near = harness({ merchantUnder: () => true });
	gameKeyHandler(near.deps)(key('e'));
	expect(near.calls).toEqual(['clearHeld', 'openShop']);

	const away = harness({ merchantUnder: () => false });
	gameKeyHandler(away.deps)(key('e'));
	expect(away.calls).toEqual(['press:e']);
});

test('an unclaimed key falls through the whole stack to the Avatar', () => {
	const t = harness();
	gameKeyHandler(t.deps)(key('j'));
	expect(t.calls).toEqual(['press:j']);
});
