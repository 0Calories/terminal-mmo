import { expect, test } from 'bun:test';
import { AUDIO_DEFAULTS } from '../src/config';
import {
	AUDIO_ROWS,
	audioKeyAction,
	audioOptionsRows,
	clampSelection,
	VOLUME_STEP,
	volumeBar,
} from '../src/ui/audio-options';

test('audio keys map to navigation, configured adjustment, mute, close, or no action', () => {
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
	expect(audioKeyAction('m')).toEqual({ kind: 'toggleMute' });
	expect(audioKeyAction('escape')).toEqual({ kind: 'close' });
	expect(audioKeyAction('z')).toEqual({ kind: 'none' });
});

test('selection clamps to the configured audio rows', () => {
	expect(clampSelection(0, -1)).toBe(0);
	expect(clampSelection(0, 1)).toBe(1);
	expect(clampSelection(AUDIO_ROWS.length - 1, 1)).toBe(AUDIO_ROWS.length - 1);
});

test('volume bars preserve width and report their proportional value', () => {
	const empty = volumeBar(0, 10);
	const half = volumeBar(0.5, 10);
	const full = volumeBar(1, 10);
	expect(
		new Set([empty, half, full].map((bar) => bar.split(' ')[0].length)).size,
	).toBe(1);
	expect([empty, half, full]).toEqual([
		expect.stringContaining('0%'),
		expect.stringContaining('50%'),
		expect.stringContaining('100%'),
	]);
});

test('audio rows mirror configuration and expose one focused row', () => {
	const rows = audioOptionsRows(AUDIO_DEFAULTS, 1);
	expect(rows).toHaveLength(AUDIO_ROWS.length);
	expect(rows.filter((row) => row.focused)).toHaveLength(1);
	expect(rows[1].focused).toBe(true);

	const changed = audioOptionsRows(
		{
			...AUDIO_DEFAULTS,
			buses: { ...AUDIO_DEFAULTS.buses, combat: 0.5 },
		},
		0,
	);
	const combat = AUDIO_ROWS.findIndex((row) => row.key === 'combat');
	expect(changed[combat].value).toContain('50%');
});
