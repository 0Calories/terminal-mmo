// Pure tests for the small-terminal degradation solver (spec #387/#398). Each
// rung is asserted by its trigger AND its reversal — the same function called
// at two sizes must flip the decision back — because "every rung is reversible"
// is the property that matters. The solver is a pure function of (terminal size,
// zoom, Frame sizes, ink count, preview override), so no screen is involved.
import { describe, expect, test } from 'bun:test';
import {
	type DegradationInput,
	FLOOR_H,
	FLOOR_W,
	previewVisible,
	solveDegradation,
} from '../src/sprite-editor/degradation';

// A comfortable above-the-floor moment; individual tests override what they probe.
function input(overrides: Partial<DegradationInput> = {}): DegradationInput {
	return {
		termW: 120,
		termH: 40,
		zoom: 2,
		maxFrameCellW: 6,
		frameCount: 1,
		inkCount: 8,
		variantRowCount: 0,
		previewOverride: null,
		...overrides,
	};
}

describe('hard floor placard (spec #398)', () => {
	test('below either dimension a placard replaces the layout, carrying the live size', () => {
		const narrow = solveDegradation(input({ termW: 79, termH: 40 }));
		expect(narrow.placard).not.toBeNull();
		const short = solveDegradation(input({ termW: 120, termH: 23 }));
		expect(short.placard).not.toBeNull();
		// The placard names the requirement and the current size, live.
		const both = solveDegradation(input({ termW: 70, termH: 20 }));
		expect(both.placard).toContain(`≥${FLOOR_W}×${FLOOR_H}`);
		expect(both.placard).toContain('70×20');
	});

	test('at exactly the floor the editor renders — no placard', () => {
		expect(
			solveDegradation(input({ termW: 80, termH: 24 })).placard,
		).toBeNull();
	});

	test('recovery: shrinking below then growing back to the floor clears the placard', () => {
		expect(
			solveDegradation(input({ termW: 78, termH: 24 })).placard,
		).not.toBeNull();
		expect(
			solveDegradation(input({ termW: 80, termH: 24 })).placard,
		).toBeNull();
	});
});

describe('rung 1 — preview auto-hide (spec #398)', () => {
	test('auto-hides at the narrow floor and shows again when the terminal widens', () => {
		// At width 80 the fixed-width float covers more than half the interior.
		expect(solveDegradation(input({ termW: 80 })).previewAutoShow).toBe(false);
		// Widening past the crossover restores it — the rung is reversible.
		expect(solveDegradation(input({ termW: 120 })).previewAutoShow).toBe(true);
	});

	test('the manual override wins in both directions', () => {
		// Force-visible while the auto rung would hide it…
		expect(previewVisible(false, true)).toBe(true);
		// …and force-hidden while the auto rung would show it.
		expect(previewVisible(true, false)).toBe(false);
		// No override follows the auto decision.
		expect(previewVisible(true, null)).toBe(true);
		expect(previewVisible(false, null)).toBe(false);
	});
});

describe('rung 2 — strips force focus (spec #398)', () => {
	test('forces focus when fewer than two full Frames fit, and reverts when they do', () => {
		// Wide Frames (12 cells → 48 screen cols at ×2): two + gap need 98 cols.
		const cramped = input({ maxFrameCellW: 12, frameCount: 2, termW: 100 });
		expect(solveDegradation(cramped).forceFocus).toBe(true);
		expect(solveDegradation(cramped).focusHint).not.toBe('');
		// A wider terminal fits two side by side again — reversible.
		const roomy = solveDegradation({ ...cramped, termW: 150 });
		expect(roomy.forceFocus).toBe(false);
		expect(roomy.focusHint).toBe('');
	});

	test('zooming out fits two Frames again, clearing the force', () => {
		const base = input({
			maxFrameCellW: 12,
			frameCount: 2,
			termW: 100,
			zoom: 2,
		});
		expect(solveDegradation(base).forceFocus).toBe(true);
		expect(solveDegradation({ ...base, zoom: 1 }).forceFocus).toBe(false);
	});

	test('a single-Frame doc never forces focus — there is no second Frame to lose', () => {
		const single = input({ maxFrameCellW: 40, frameCount: 1, termW: 100 });
		expect(solveDegradation(single).forceFocus).toBe(false);
	});
});

describe('rung 3 — edit box folds (spec #398)', () => {
	test('folds when the rail cannot fit the full ink grid and the edit box, and unfolds when it can', () => {
		// An absurdly long palette (many grid rows) at a squat height cannot
		// share the rail with the box; taller terminals fit both — reversible.
		const short = input({ termW: 100, termH: 24, inkCount: 90 });
		expect(solveDegradation(short).foldPlayback).toBe(true);
		expect(solveDegradation({ ...short, termH: 40 }).foldPlayback).toBe(false);
	});

	test('the standard palette + variants keep the full box at the 80×24 floor (mouse-primary, ADR 0035)', () => {
		// The `edit` box carries the mouse-only buttons, so the honest grid
		// accounting must keep it unfolded for a real doc at the floor.
		expect(
			solveDegradation(
				input({ termW: 80, termH: 24, inkCount: 17, variantRowCount: 2 }),
			).foldPlayback,
		).toBe(false);
	});
});
