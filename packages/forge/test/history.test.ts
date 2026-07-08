import { describe, expect, test } from 'bun:test';
import {
	canRedo,
	canUndo,
	HISTORY_CAP,
	type History,
	initHistory,
	record,
	redo,
	undo,
} from '../src/history';

// The tests use strings as stand-in states — History<T> is generic (the editor
// stores `EditorDoc` snapshots). Coalescing merges one drag into a single step (#98).

describe('initHistory', () => {
	test('starts with the present and empty stacks', () => {
		const h = initHistory('a');
		expect(h.present).toBe('a');
		expect(h.past).toEqual([]);
		expect(h.future).toEqual([]);
		expect(canUndo(h)).toBe(false);
		expect(canRedo(h)).toBe(false);
	});
});

describe('record', () => {
	test('pushes the prior present onto past and updates the present', () => {
		const h = record(initHistory('a'), 'b');
		expect(h.present).toBe('b');
		expect(h.past).toEqual(['a']);
		expect(canUndo(h)).toBe(true);
	});

	test('a new edit clears the redo future', () => {
		let h = record(initHistory('a'), 'b');
		h = undo(h); // present back to 'a', future = ['b']
		expect(canRedo(h)).toBe(true);
		h = record(h, 'c');
		expect(h.future).toEqual([]);
		expect(canRedo(h)).toBe(false);
		expect(h.past).toEqual(['a']);
	});

	test('caps the past at HISTORY_CAP, dropping the oldest', () => {
		let h = initHistory('s0');
		for (let i = 1; i <= HISTORY_CAP + 50; i++) h = record(h, `s${i}`);
		expect(h.past.length).toBe(HISTORY_CAP);
		// oldest retained is s50 (the first 50 fell off the bottom)
		expect(h.past[0]).toBe('s50');
		expect(h.present).toBe(`s${HISTORY_CAP + 50}`);
	});
});

describe('record with coalescing tag', () => {
	test('same tag merges into the current step (no new past entry)', () => {
		let h = record(initHistory('a'), 'b', 'stroke1'); // first cell of a drag
		expect(h.past).toEqual(['a']);
		h = record(h, 'c', 'stroke1');
		h = record(h, 'd', 'stroke1');
		expect(h.present).toBe('d');
		expect(h.past).toEqual(['a']); // still ONE step for the whole drag
		// one undo reverts the entire stroke
		expect(undo(h).present).toBe('a');
	});

	test('a different tag begins a new step', () => {
		let h = record(initHistory('a'), 'b', 'stroke1');
		h = record(h, 'c', 'stroke2');
		expect(h.past).toEqual(['a', 'b']);
		expect(undo(h).present).toBe('b');
	});

	test('an untagged edit never coalesces, even back-to-back', () => {
		let h = record(initHistory('a'), 'b');
		h = record(h, 'c');
		expect(h.past).toEqual(['a', 'b']);
	});

	test('coalescing still clears the redo future', () => {
		let h = record(initHistory('a'), 'b', 'stroke1');
		h = undo(h); // future = ['b']
		h = record(h, 'z', 'stroke1'); // tag matches the (now-undone) step? -> new edit
		expect(h.future).toEqual([]);
	});
});

describe('undo / redo', () => {
	test('undo moves present to future and pops past', () => {
		let h = record(record(initHistory('a'), 'b'), 'c');
		h = undo(h);
		expect(h.present).toBe('b');
		expect(h.future).toEqual(['c']);
		expect(h.past).toEqual(['a']);
	});

	test('redo replays the most recent undo', () => {
		let h = record(record(initHistory('a'), 'b'), 'c');
		h = undo(h);
		h = redo(h);
		expect(h.present).toBe('c');
		expect(h.future).toEqual([]);
		expect(h.past).toEqual(['a', 'b']);
	});

	test('undo at the bottom is a no-op', () => {
		const h = initHistory('a');
		expect(undo(h)).toEqual(h);
		expect(canUndo(h)).toBe(false);
	});

	test('redo with nothing ahead is a no-op', () => {
		const h = record(initHistory('a'), 'b');
		expect(redo(h)).toEqual(h);
		expect(canRedo(h)).toBe(false);
	});

	test('round-trips a sequence of edits', () => {
		let h = initHistory('a');
		h = record(h, 'b');
		h = record(h, 'c');
		h = undo(undo(h));
		expect(h.present).toBe('a');
		h = redo(redo(h));
		expect(h.present).toBe('c');
	});

	test('an edit after undo cannot coalesce with a step across the undo', () => {
		// undo resets the coalesce anchor so the next stroke is its own step.
		let h = record(initHistory('a'), 'b', 'stroke1');
		h = undo(h);
		h = record(h, 'c', 'stroke1');
		expect(h.past).toEqual(['a']);
		expect(undo(h).present).toBe('a');
	});
});

describe('history type shape', () => {
	test('History<T> is generic over the state', () => {
		const h: History<number> = initHistory(0);
		expect(record(h, 1).present).toBe(1);
	});
});
