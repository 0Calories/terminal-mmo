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

// Build a resolved capability object with a chosen kitty_keyboard flag. Only that field
// matters to the predicate; the rest are filled with harmless defaults so the fixture is
// a real TerminalCapabilities shape.
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

// The AC's truth table (ADR 0024 §2): warn ONLY on a resolved, confirmed no-Kitty
// terminal; every unresolved / unknown state is fail-open silent.

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
	// A capability object whose kitty_keyboard never resolved to a real boolean must not
	// trip the warning — only a strict `false` does.
	const unknown = {
		...caps(false),
		kitty_keyboard: undefined,
	} as unknown as TerminalCapabilities;
	expect(shouldWarnNoKitty(unknown)).toBe(false);
});

// The embedded remedy is self-contained: a short, non-empty terminal list and a
// tmux/screen caveat, with no external URL (ADR 0024 §4).

test('the terminal list is short, non-empty, and URL-free', () => {
	expect(KITTY_TERMINALS.length).toBeGreaterThan(0);
	expect(KITTY_TERMINALS.length).toBeLessThanOrEqual(8);
	for (const name of KITTY_TERMINALS) expect(name).not.toContain('://');
});

test('the caveat names a multiplexer and carries no URL', () => {
	expect(MULTIPLEXER_CAVEAT.toLowerCase()).toContain('tmux');
	expect(MULTIPLEXER_CAVEAT).not.toContain('://');
});

// --- Strict sequential pre-gate (#301) --------------------------------------
//
// The notice must win the SCREEN, not just the keyboard: on a confirmed no-Kitty terminal
// it draws over every other launch overlay so the Player can read it, and nothing else is
// shown or interactive until it is dismissed. These headless render checks (via
// `@opentui/core/testing`) prove the layering and the gate, no TTY needed.

// A sentinel unique to each overlay's INTERIOR — the notice's press-any-key footer and one
// of the creator's field rows — so "which one is on top" is decided by whose interior
// survived compositing where the two centered panels overlap, not by a border that peeks.
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
	// The real launch order that used to lose: the notice attaches first, the creator later.
	// With equal z the later node won and buried the notice — the raised z fixes it (#301).
	notice.attach(renderer.root);
	creator.attach(renderer.root);

	// First establish the baseline: with only the creator up, its interior row DOES render
	// at this geometry — so the sentinel's later absence can only mean the notice covered it,
	// not that it was never drawn.
	creator.show();
	await renderOnce();
	expect(captureCharFrame()).toContain(CREATOR_BODY);

	// Now raise the notice over the (still-shown) creator: the notice interior wins and the
	// creator interior is buried where the two centered panels overlap.
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

	// The launch path on a capable terminal: shouldWarnNoKitty is false, so the notice is
	// never shown; the gate then reveals the queued creator at once — launch unaffected.
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

	// The notice is up first, then the creator is queued behind it: the gate must hold it
	// hidden and un-interactive, so only the notice is on screen.
	notice.show();
	gate.reconcile();
	gate.request(creator);
	expect(creator.open).toBe(false);
	await renderOnce();
	let frame = captureCharFrame();
	expect(frame).toContain(NOTICE_BODY);
	expect(frame).not.toContain(CREATOR_BODY);

	// The first keypress dismisses the notice; the gate then releases the queued creator.
	notice.hide();
	gate.reconcile();
	expect(creator.open).toBe(true);
	await renderOnce();
	frame = captureCharFrame();
	expect(frame).not.toContain(NOTICE_BODY);
	expect(frame).toContain(CREATOR_BODY);
});

// The gate logic on its own (renderer-free): intent is tracked separately from the notice
// so a late-resolving probe still wins, and a released modal is never re-shown.
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
	gate.request(modal); // shown while the probe is still unresolved (fail-open)
	expect(modal.open).toBe(true);
	notice.open = true; // the slow probe finally confirms no-Kitty
	gate.reconcile();
	expect(modal.open).toBe(false);
	notice.open = false; // dismissed
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
	expect(modal.open).toBe(false); // stayed gone — the gate no longer tracks it
});
