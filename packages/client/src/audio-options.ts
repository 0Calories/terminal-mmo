// The audio options modal's pure, testable seam (ADR 0014/0015, #150). The retained-UI
// shell that applies actions to the live SoundSystem lives in audio-options-view.ts.

import type { AudioPrefs } from './config';

// Volume step per left/right press. Coarse on purpose — holding a key isn't smooth in a terminal.
export const VOLUME_STEP = 0.1;

// The adjustable rows: master then the three voiced buses (`ambient` has no voices yet).
// `key` selects the volume read/written. Master mute is not a row — it toggles via `m`.
export type AudioRowKey = 'master' | keyof AudioPrefs['buses'];

export interface AudioRowDef {
	key: AudioRowKey;
	label: string;
}

export const AUDIO_ROWS: readonly AudioRowDef[] = [
	{ key: 'master', label: 'Master' },
	{ key: 'combat', label: 'Combat' },
	{ key: 'movement', label: 'Movement' },
	{ key: 'ui', label: 'UI' },
];

// A key resolves to one intent; the shell applies it to the live mixer, keeping this pure.
export type AudioAction =
	| { kind: 'move'; delta: number } // change the selected row
	| { kind: 'adjust'; delta: number } // change the selected row's volume
	| { kind: 'toggleMute' }
	| { kind: 'close' }
	| { kind: 'none' };

export function audioKeyAction(key: string): AudioAction {
	switch (key) {
		case 'up':
			return { kind: 'move', delta: -1 };
		case 'down':
			return { kind: 'move', delta: 1 };
		case 'left':
			return { kind: 'adjust', delta: -VOLUME_STEP };
		case 'right':
			return { kind: 'adjust', delta: VOLUME_STEP };
		case 'm':
			return { kind: 'toggleMute' };
		case 'o':
		case 'escape':
			return { kind: 'close' };
		default:
			return { kind: 'none' };
	}
}

// Step the selection, clamped to the row range (no wraparound, so the list has clear ends).
export function clampSelection(selected: number, delta: number): number {
	return Math.max(0, Math.min(AUDIO_ROWS.length - 1, selected + delta));
}

// A filled/empty block bar plus a percentage, e.g. `█████░░░░░ 50%`.
export function volumeBar(vol: number, width = 10): string {
	const filled = Math.round(vol * width);
	return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(vol * 100)}%`;
}

export interface AudioOptionsRow {
	label: string;
	value: string;
	focused: boolean;
}

export function audioOptionsRows(
	prefs: AudioPrefs,
	selected: number,
	barWidth = 10,
): AudioOptionsRow[] {
	return AUDIO_ROWS.map((r, i) => {
		const vol = r.key === 'master' ? prefs.master : prefs.buses[r.key];
		return {
			label: r.label,
			value: volumeBar(vol, barWidth),
			focused: i === selected,
		};
	});
}
