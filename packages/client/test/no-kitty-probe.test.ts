import { expect, test } from 'bun:test';
import type { TerminalCapabilities } from '@opentui/core';
import { KittyProbe } from '../src/input/no-kitty-probe';

function caps(kitty: boolean | undefined): TerminalCapabilities {
	return { kitty_keyboard: kitty } as unknown as TerminalCapabilities;
}

function timers() {
	let next = 1;
	const pending = new Map<number, () => void>();
	return {
		setTimer(fn: () => void) {
			const id = next++;
			pending.set(id, fn);
			return id;
		},
		clearTimer(h: unknown) {
			pending.delete(h as number);
		},
		settle() {
			for (const fn of [...pending.values()]) fn();
			pending.clear();
		},
		get scheduled() {
			return pending.size;
		},
	};
}

function probe(initial: TerminalCapabilities | null) {
	const t = timers();
	let current = initial;
	const notice = {
		open: false,
		show() {
			this.open = true;
		},
		hide() {
			this.open = false;
		},
	};
	let reconciled = 0;
	const p = new KittyProbe({
		notice,
		capabilities: () => current,
		onNoticeChanged: () => {
			reconciled++;
		},
		setTimer: t.setTimer,
		clearTimer: t.clearTimer,
	});
	return {
		probe: p,
		notice,
		timers: t,
		set: (c: TerminalCapabilities | null) => {
			current = c;
		},
		reconciled: () => reconciled,
	};
}

test('a terminal that reports Kitty support up front never warns', () => {
	const h = probe(caps(true));
	h.probe.observe(caps(false));
	h.timers.settle();
	expect(h.notice.open).toBe(false);
});

test('the pre-probe default false does not warn until the burst settles quiet', () => {
	const h = probe(caps(false));
	h.probe.observe(caps(false));
	expect(h.notice.open).toBe(false);
	h.timers.settle();
	expect(h.notice.open).toBe(true);
	expect(h.reconciled()).toBe(1);
});

test('a late positive inside the settle window cancels the pending warning', () => {
	const h = probe(caps(false));
	h.probe.observe(caps(false));
	h.set(caps(true));
	h.probe.observe(caps(true));
	expect(h.timers.scheduled).toBe(0);
	h.timers.settle();
	expect(h.notice.open).toBe(false);
});

test('a positive arriving after the warning is already up takes it back down', () => {
	const h = probe(caps(false));
	h.probe.observe(caps(false));
	h.timers.settle();
	expect(h.notice.open).toBe(true);

	h.set(caps(true));
	h.probe.observe(caps(true));
	expect(h.notice.open).toBe(false);
	expect(h.reconciled()).toBe(2);
});

test('each negative restarts the settle window rather than stacking timers', () => {
	const h = probe(caps(false));
	h.probe.observe(caps(false));
	h.probe.observe(caps(false));
	h.probe.observe(caps(false));
	expect(h.timers.scheduled).toBe(1);
});

test('capabilities that never resolve stay silent (fail-open)', () => {
	const h = probe(null);
	h.probe.observe(null);
	h.timers.settle();
	expect(h.notice.open).toBe(false);
});

test('an unknown kitty_keyboard field stays silent (fail-open)', () => {
	const h = probe(caps(undefined));
	h.probe.observe(caps(undefined));
	h.timers.settle();
	expect(h.notice.open).toBe(false);
});

test('dismiss hides the notice and reconciles the modals it was gating', () => {
	const h = probe(caps(false));
	h.probe.observe(caps(false));
	h.timers.settle();
	h.probe.dismiss();
	expect(h.notice.open).toBe(false);
	expect(h.reconciled()).toBe(2);
});

test('a settle that lands while the notice is already up does not re-show it', () => {
	const h = probe(caps(false));
	h.probe.observe(caps(false));
	h.timers.settle();
	const after = h.reconciled();
	h.probe.observe(caps(false));
	h.timers.settle();
	expect(h.reconciled()).toBe(after);
});
