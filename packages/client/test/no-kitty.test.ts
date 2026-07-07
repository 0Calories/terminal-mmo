import { expect, test } from 'bun:test';
import type { TerminalCapabilities } from '@opentui/core';
import {
	KITTY_TERMINALS,
	MULTIPLEXER_CAVEAT,
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
