import { expect, test } from 'bun:test';
import { CAPABILITY_UNLOCK } from '@mmo/shared';
import { CONTROL_ROWS, controlRowText, keysFor } from '../src/controls';

// The controls overlay must cover EVERY input the AC lists (#242): move, jump, attack,
// block, dodge, both skills, emote, and chat. This asserts none silently drops off the
// cheat-sheet.
test('the controls listing covers every required input', () => {
	const labels = CONTROL_ROWS.map((r) => r.label);
	for (const required of [
		'Move',
		'Jump',
		'Attack',
		'Block',
		'Dodge',
		'Power Strike',
		'Ground Pound',
		'Emote',
		'Chat',
	])
		expect(labels).toContain(required);
});

test('every level-gated row maps to a real capability in the ladder', () => {
	for (const row of CONTROL_ROWS)
		if (row.capability)
			expect(CAPABILITY_UNLOCK[row.capability]).toBeGreaterThanOrEqual(1);
});

test('a gated verb shows its unlock level when locked and hides it once earned', () => {
	const dodge = CONTROL_ROWS.find((r) => r.capability === 'dodge');
	if (!dodge) throw new Error('expected a Dodge row');
	const unlock = CAPABILITY_UNLOCK.dodge; // 4
	expect(controlRowText(dodge, 1, 'keyboard')).toContain(
		`unlocks at L${unlock}`,
	);
	expect(controlRowText(dodge, unlock, 'keyboard')).not.toContain('unlocks at');
});

test('an ungated verb never shows an unlock note at any level', () => {
	const jump = CONTROL_ROWS.find((r) => r.label === 'Jump');
	if (!jump) throw new Error('expected a Jump row');
	expect(controlRowText(jump, 1, 'keyboard')).not.toContain('unlocks at');
	expect(controlRowText(jump, 5, 'keyboard')).not.toContain('unlocks at');
});

test('the mouse scheme shows the rebound keys, not the keyboard ones', () => {
	const attack = CONTROL_ROWS.find((r) => r.label === 'Attack');
	if (!attack) throw new Error('expected an Attack row');
	// Attack moves to the left mouse button under MMO_SCHEME=mouse (input.ts).
	expect(keysFor(attack, 'keyboard')).toContain('j');
	expect(keysFor(attack, 'mouse')).toContain('click');
	expect(keysFor(attack, 'mouse')).not.toContain('j');
	// A row with no mouse override falls back to its keyboard keys.
	const jump = CONTROL_ROWS.find((r) => r.label === 'Jump');
	if (!jump) throw new Error('expected a Jump row');
	expect(keysFor(jump, 'mouse')).toBe(keysFor(jump, 'keyboard'));
});
