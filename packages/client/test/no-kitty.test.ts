import { expect, test } from 'bun:test';
import type { TerminalCapabilities } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { CharacterCreator } from '../src/character-creator';
import {
	type Gateable,
	KITTY_TERMINALS,
	MULTIPLEXER_CAVEAT,
	NoKittyNotice,
	NoticeGate,
	shouldWarnNoKitty,
} from '../src/no-kitty';

function caps(kitty: boolean): TerminalCapabilities {
	return {
		kitty_keyboard: kitty,
		kitty_graphics: false,
		rgb: true,
		ansi256: true,
		unicode: 'unicode',
		sgr_pixels: false,
		color_scheme_updates: false,
		explicit_width: false,
		scaled_text: false,
		sixel: false,
		focus_tracking: false,
		sync: false,
		bracketed_paste: false,
		hyperlinks: false,
		osc52: false,
		notifications: false,
		explicit_cursor_positioning: false,
		remote: false,
		multiplexer: 'none',
		terminal: { name: 'test', version: '0', from_xtversion: false },
	} as TerminalCapabilities;
}

test('resolved + no Kitty support → warn', () => {
	expect(shouldWarnNoKitty(caps(false))).toBe(true);
});

test('resolved + Kitty support → no warn', () => {
	expect(shouldWarnNoKitty(caps(true))).toBe(false);
});

test('unresolved capabilities (null) → no warn (fail-open)', () => {
	expect(shouldWarnNoKitty(null)).toBe(false);
});

test('unresolved capabilities (undefined) → no warn (fail-open)', () => {
	expect(shouldWarnNoKitty(undefined)).toBe(false);
});

test('unknown / missing kitty_keyboard field → no warn (fail-open)', () => {
	const unknown = {
		...caps(false),
		kitty_keyboard: undefined,
	} as unknown as TerminalCapabilities;
	expect(shouldWarnNoKitty(unknown)).toBe(false);
});

test('the terminal list is short, non-empty, and URL-free', () => {
	expect(KITTY_TERMINALS.length).toBeGreaterThan(0);
	expect(KITTY_TERMINALS.length).toBeLessThanOrEqual(8);
	for (const name of KITTY_TERMINALS) expect(name).not.toContain('://');
});

test('the caveat names a multiplexer and carries no URL', () => {
	expect(MULTIPLEXER_CAVEAT.toLowerCase()).toContain('tmux');
	expect(MULTIPLEXER_CAVEAT).not.toContain('://');
});

// sentinels unique to each overlay's interior, so compositing decides which is on top
const NOTICE_BODY = 'Press any key to continue';
const CREATOR_BODY = 'Nameplate';

const STARTER_LOOK = { hue: 0, hat: 0, nameplate: 0, form: 0 } as const;

test('the notice draws ABOVE the Avatar creator (top layer), matching the real attach order', async () => {
	const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
		width: 100,
		height: 40,
		kittyKeyboard: false,
	});
	const notice = new NoKittyNotice(renderer);
	const creator = new CharacterCreator(renderer, 'tester', STARTER_LOOK);
	notice.attach(renderer.root);
	creator.attach(renderer.root);

	// baseline: the creator interior renders here, so its later absence means the notice covered it
	creator.show();
	await renderOnce();
	expect(captureCharFrame()).toContain(CREATOR_BODY);

	notice.show();
	await renderOnce();
	const frame = captureCharFrame();
	expect(frame).toContain(NOTICE_BODY);
	expect(frame).not.toContain(CREATOR_BODY);
});

test('on a Kitty-capable terminal the notice never appears and the creator shows immediately', async () => {
	const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
		width: 100,
		height: 40,
		kittyKeyboard: true,
	});
	const notice = new NoKittyNotice(renderer);
	const creator = new CharacterCreator(renderer, 'tester', STARTER_LOOK);
	notice.attach(renderer.root);
	creator.attach(renderer.root);
	const gate = new NoticeGate(notice);

	const capable = caps(true);
	if (shouldWarnNoKitty(capable)) notice.show();
	gate.reconcile();
	gate.request(creator);
	await renderOnce();

	const frame = captureCharFrame();
	expect(notice.open).toBe(false);
	expect(frame).not.toContain(NOTICE_BODY);
	expect(frame).toContain(CREATOR_BODY);
});

test('the gate holds the creator hidden while the notice is open, then reveals it on dismissal', async () => {
	const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
		width: 100,
		height: 40,
		kittyKeyboard: false,
	});
	const notice = new NoKittyNotice(renderer);
	const creator = new CharacterCreator(renderer, 'tester', STARTER_LOOK);
	notice.attach(renderer.root);
	creator.attach(renderer.root);
	const gate = new NoticeGate(notice);

	notice.show();
	gate.reconcile();
	gate.request(creator);
	expect(creator.open).toBe(false);
	await renderOnce();
	let frame = captureCharFrame();
	expect(frame).toContain(NOTICE_BODY);
	expect(frame).not.toContain(CREATOR_BODY);

	notice.hide();
	gate.reconcile();
	expect(creator.open).toBe(true);
	await renderOnce();
	frame = captureCharFrame();
	expect(frame).not.toContain(NOTICE_BODY);
	expect(frame).toContain(CREATOR_BODY);
});

function fakeModal(): Gateable & { visible: boolean } {
	return {
		visible: false,
		get open() {
			return this.visible;
		},
		show() {
			this.visible = true;
		},
		hide() {
			this.visible = false;
		},
	};
}

test('gate: a modal requested while the notice is clear shows immediately', () => {
	const gate = new NoticeGate({ open: false });
	const modal = fakeModal();
	gate.request(modal);
	expect(modal.open).toBe(true);
});

test('gate: a modal requested while the notice is open is held until dismissal', () => {
	const notice = { open: true };
	const gate = new NoticeGate(notice);
	const modal = fakeModal();
	gate.request(modal);
	expect(modal.open).toBe(false);
	notice.open = false;
	gate.reconcile();
	expect(modal.open).toBe(true);
});

test('gate: a late-resolving notice re-hides a modal already on screen, then re-shows it', () => {
	const notice = { open: false };
	const gate = new NoticeGate(notice);
	const modal = fakeModal();
	gate.request(modal);
	expect(modal.open).toBe(true);
	notice.open = true;
	gate.reconcile();
	expect(modal.open).toBe(false);
	notice.open = false;
	gate.reconcile();
	expect(modal.open).toBe(true);
});

test('gate: a released modal is hidden and never re-shown by a later reconcile', () => {
	const notice = { open: false };
	const gate = new NoticeGate(notice);
	const modal = fakeModal();
	gate.request(modal);
	gate.release(modal);
	expect(modal.open).toBe(false);
	notice.open = true;
	gate.reconcile();
	notice.open = false;
	gate.reconcile();
	expect(modal.open).toBe(false);
});
