import { expect, test } from 'bun:test';
import { CAPABILITY_UNLOCK } from '@mmo/core/progression';
import { CONTROL_ROWS, controlRowText, keysFor } from '../src/ui/controls';

test('control rows have distinct labels and valid capability gates', () => {
	expect(CONTROL_ROWS.length).toBeGreaterThan(0);
	expect(new Set(CONTROL_ROWS.map((row) => row.label)).size).toBe(
		CONTROL_ROWS.length,
	);
	for (const row of CONTROL_ROWS)
		if (row.capability)
			expect(CAPABILITY_UNLOCK[row.capability]).toBeGreaterThanOrEqual(1);
});

test('capability-gated rows distinguish locked and unlocked outcomes', () => {
	for (const row of CONTROL_ROWS) {
		if (!row.capability) continue;
		const unlock = CAPABILITY_UNLOCK[row.capability];
		const locked = controlRowText(row, unlock - 1, 'keyboard');
		const unlocked = controlRowText(row, unlock, 'keyboard');
		expect(locked).toContain(row.label);
		expect(locked).toContain(keysFor(row, 'keyboard'));
		expect(locked).not.toBe(unlocked);
	}
});

test('mouse-specific bindings replace keyboard bindings without changing shared ones', () => {
	for (const row of CONTROL_ROWS) {
		const keyboard = keysFor(row, 'keyboard');
		const mouse = keysFor(row, 'mouse');
		if (row.mouseKeys) {
			expect(mouse).toBe(row.mouseKeys);
			expect(mouse).not.toBe(keyboard);
		} else {
			expect(mouse).toBe(keyboard);
		}
	}
});
