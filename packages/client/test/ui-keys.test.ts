import { expect, test } from 'bun:test';
import type { GameKeyDeps, Key, LobbyKeyDeps } from '../src/input/ui-keys';
import { gameKeyHandler, lobbyKeyHandler } from '../src/input/ui-keys';

function key(name: string, sequence = name): Key {
	return { name, sequence, ctrl: false, meta: false, preventDefault: () => {} };
}

function overlay(open = false) {
	return {
		open,
		hide() {
			this.open = false;
		},
		show() {
			this.open = true;
		},
	};
}

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

function harness(over: Partial<GameKeyDeps> = {}): Trace {
	const calls: string[] = [];
	const record = (name: string) => () => calls.push(name);
	const notice = { open: false };
	const hud = {
		chatOpen: false,
		openChat: record('openChat'),
		closeChat: record('closeChat'),
	};
	const controls = overlay();
	const options = overlay();
	const shop = Object.assign(overlay(), { mode: 'sell' as 'sell' | 'buy' });
	const trace: Trace = {
		calls,
		notice,
		hud,
		controls,
		options,
		shop,
		recustomize: null,
		deps: undefined as unknown as GameKeyDeps,
	};
	trace.deps = {
		scheme: 'keyboard',
		interactKey: 'e',
		noKittyNotice: notice,
		dismissNoKittyNotice: record('dismissNotice'),
		hud,
		options: Object.assign(options, {
			key: (pressed: string) => calls.push(`options:${pressed}`),
		}),
		controls: Object.assign(controls, {
			show: () => calls.push('showControls'),
		}),
		shop: Object.assign(shop, {
			count: () => 0,
			switchTab: record('switchTab'),
			move: record('moveSelection'),
			update: record('updateShop'),
		}),
		shopView: () => ({
			inventory: [],
			progress: { level: 1, xp: 0, gold: 0 },
		}),
		buySelected: record('buy'),
		sellSelected: record('sell'),
		openShop: record('openShop'),
		merchantUnder: () => false,
		recustomize: () => trace.recustomize,
		submitRecustomize: () => calls.push('submitRecustomize'),
		openRecustomize: record('openRecustomize'),
		inTown: () => true,
		level: () => 7,
		notice: record('notice'),
		toggleMute: record('toggleMute'),
		blip: record('blip'),
		clearHeldKeys: record('clearHeld'),
		pressMovement: (name) => calls.push(`press:${name}`),
		quit: record('quit'),
		...over,
	};
	return trace;
}

test('the lobby routes by modal state before quit or creator input', () => {
	const blocked = lobby({ creating: () => true });
	blocked.notice.open = true;
	blocked.handle(key('q'));
	expect(blocked.calls).toEqual(['dismiss']);

	const waiting = lobby();
	waiting.handle(key('q'));
	waiting.handle(key('j'));
	expect(waiting.calls).toEqual(['quit']);

	const creating = lobby({ creating: () => true });
	creating.handle(key('down'));
	expect(creating.calls).toEqual(['blip', 'submit']);
});

test('game overlays consume input in modal-priority order', () => {
	const notice = harness();
	notice.notice.open = true;
	gameKeyHandler(notice.deps)(key('q'));
	expect(notice.calls).toEqual(['dismissNotice']);

	const chat = harness();
	chat.hud.chatOpen = true;
	const chatKeys = gameKeyHandler(chat.deps);
	chatKeys(key('q'));
	chatKeys(key('escape'));
	expect(chat.calls).toEqual(['closeChat']);

	const options = harness();
	options.options.open = true;
	gameKeyHandler(options.deps)(key('m'));
	expect(options.calls).toEqual(['options:m']);

	const controls = harness();
	controls.controls.open = true;
	const controlKeys = gameKeyHandler(controls.deps);
	controlKeys(key('j'));
	controlKeys(key('?'));
	expect(controls.controls.open).toBe(false);
});

test('shop and recustomize modals own their actions and dismissal', () => {
	for (const [mode, action] of [
		['buy', 'buy'],
		['sell', 'sell'],
	] as const) {
		const trace = harness();
		trace.shop.open = true;
		trace.shop.mode = mode;
		gameKeyHandler(trace.deps)(key('return'));
		expect(trace.calls).toContain(action);
	}

	const shop = harness();
	shop.shop.open = true;
	gameKeyHandler(shop.deps)(key('e'));
	expect(shop.shop.open).toBe(false);

	const customize = harness();
	customize.recustomize = overlay(true);
	const customizeKeys = gameKeyHandler(customize.deps);
	customizeKeys(key('j'));
	customizeKeys(key('escape'));
	expect(customize.calls).toContain('submitRecustomize');
	expect(customize.recustomize.open).toBe(false);
});

test('global commands act only when no modal owns the key', () => {
	const trace = harness();
	const handle = gameKeyHandler(trace.deps);
	handle(key('m'));
	handle(key('?'));
	handle(key('c'));
	handle(key('q'));
	expect(trace.calls).toEqual(
		expect.arrayContaining([
			'toggleMute',
			'showControls',
			'openRecustomize',
			'quit',
		]),
	);

	const outsideTown = harness({ inTown: () => false });
	gameKeyHandler(outsideTown.deps)(key('c'));
	expect(outsideTown.calls).toEqual(['notice']);
});

test('chat, merchant interaction, and unclaimed input clear or preserve held state appropriately', () => {
	const chat = harness();
	let prevented = false;
	const enter = key('return');
	enter.preventDefault = () => {
		prevented = true;
	};
	gameKeyHandler(chat.deps)(enter);
	expect(prevented).toBe(true);
	expect(chat.calls).toEqual(['openChat', 'clearHeld']);

	const merchant = harness({ merchantUnder: () => true });
	gameKeyHandler(merchant.deps)(key('e'));
	expect(merchant.calls).toEqual(['clearHeld', 'openShop']);

	const movement = harness();
	gameKeyHandler(movement.deps)(key('j'));
	expect(movement.calls).toEqual(['press:j']);
});
