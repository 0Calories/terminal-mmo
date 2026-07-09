import { expect, test } from 'bun:test';
import {
	AUDIO_ROWS,
	audioKeyAction,
	audioOptionsRows,
	clampSelection,
	VOLUME_STEP,
	volumeBar,
} from '../src/audio-options';
import { AUDIO_DEFAULTS } from '../src/config';

test('arrows map to move (up/down) and adjust (left/right) by a volume step', () => {
	expect(audioKeyAction('up')).toEqual({ kind: 'move', delta: -1 });
	expect(audioKeyAction('down')).toEqual({ kind: 'move', delta: 1 });
	expect(audioKeyAction('left')).toEqual({
		kind: 'adjust',
		delta: -VOLUME_STEP,
	});
	expect(audioKeyAction('right')).toEqual({
		kind: 'adjust',
		delta: VOLUME_STEP,
	});
});

test('m toggles mute; o and escape close; anything else is inert', () => {
	expect(audioKeyAction('m')).toEqual({ kind: 'toggleMute' });
	expect(audioKeyAction('o')).toEqual({ kind: 'close' });
	expect(audioKeyAction('escape')).toEqual({ kind: 'close' });
	expect(audioKeyAction('z')).toEqual({ kind: 'none' });
});

test('selection clamps within the row range, never wrapping past the ends', () => {
	expect(clampSelection(0, -1)).toBe(0);
	expect(clampSelection(0, 1)).toBe(1);
	expect(clampSelection(AUDIO_ROWS.length - 1, 1)).toBe(AUDIO_ROWS.length - 1);
});

test('volumeBar fills proportionally and shows a percentage', () => {
	expect(volumeBar(1, 10)).toBe('██████████ 100%');
	expect(volumeBar(0, 10)).toBe('░░░░░░░░░░ 0%');
	expect(volumeBar(0.5, 10)).toBe('█████░░░░░ 50%');
});

test('rows list master + the three voiced buses, focusing the selected one', () => {
	const rows = audioOptionsRows(AUDIO_DEFAULTS, 1);
	expect(rows.map((r) => r.label)).toEqual([
		'Master',
		'Combat',
		'Movement',
		'UI',
	]);
	expect(rows[1].focused).toBe(true);
	expect(rows[0].focused).toBe(false);
	expect(rows[0].value).toContain('100%');
});

test('a row reflects its bus volume', () => {
	const prefs = {
		...AUDIO_DEFAULTS,
		buses: { combat: 0.5, movement: 1, ui: 1 },
	};
	const rows = audioOptionsRows(prefs, 0);
	expect(rows[1].label).toBe('Combat');
	expect(rows[1].value).toContain('50%');
});
