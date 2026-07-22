import { describe, expect, test } from 'bun:test';
import {
	canRedo,
	canUndo,
	HISTORY_CAP,
	initHistory,
	record,
	redo,
	undo,
} from '../src/history';

interface AuthoredDoc {
	readonly art: string;
}

const doc = (art: string): AuthoredDoc => ({ art });

describe('completed authoring history', () => {
	test('undo and redo traverse completed document transformations', () => {
		let history = initHistory(doc('blank'));
		history = record(history, doc('line'));
		history = record(history, doc('line + fill'));

		expect(history.present).toEqual(doc('line + fill'));
		expect(canUndo(history)).toBe(true);
		history = undo(history);
		expect(history.present).toEqual(doc('line'));
		history = undo(history);
		expect(history.present).toEqual(doc('blank'));
		expect(canUndo(history)).toBe(false);

		history = redo(redo(history));
		expect(history.present).toEqual(doc('line + fill'));
		expect(canRedo(history)).toBe(false);
	});

	test('events from one gesture coalesce into one undoable operation', () => {
		let history = initHistory(doc('blank'));
		history = record(history, doc('pixel 1'), 'stroke');
		history = record(history, doc('pixels 1-2'), 'stroke');
		history = record(history, doc('pixels 1-3'), 'stroke');

		expect(undo(history).present).toEqual(doc('blank'));
		expect(redo(undo(history)).present).toEqual(doc('pixels 1-3'));
	});

	test('editing after undo creates a new branch with no redo path', () => {
		let history = record(initHistory(doc('blank')), doc('line'));
		history = record(history, doc('line + fill'));
		history = undo(history);
		history = record(history, doc('line + ellipse'));

		expect(history.present).toEqual(doc('line + ellipse'));
		expect(canRedo(history)).toBe(false);
		expect(undo(history).present).toEqual(doc('line'));
	});

	test('history retains the configured number of completed operations', () => {
		let history = initHistory(doc('0'));
		for (let i = 1; i <= HISTORY_CAP + 1; i++)
			history = record(history, doc(String(i)));

		for (let i = 0; i < HISTORY_CAP; i++) history = undo(history);
		expect(history.present).toEqual(doc('1'));
		expect(canUndo(history)).toBe(false);
	});

	test.each([
		['undo', undo, initHistory(doc('blank'))],
		['redo', redo, record(initHistory(doc('blank')), doc('line'))],
	] as const)('%s is a no-op when no completed operation exists', (_, act, state) => {
		expect(act(state)).toEqual(state);
	});
});
