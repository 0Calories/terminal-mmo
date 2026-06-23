// The audio options modal's PURE, testable seam (ADR 0014/0015, #150): the row
// model, the key→action mapping, and the volume-bar rendering. The retained-UI
// shell that mounts these in a Shop-style panel and applies actions to the live
// SoundSystem lives in audio-options-view.ts (rendering, eyeball-only). Mirrors how
// customize.ts is the tested seam behind character-creator.ts.

import type { AudioPrefs } from './config';

// How much one left/right press moves a volume. Coarse on purpose — a few presses
// span the whole range in a terminal where holding a key isn't smooth.
export const VOLUME_STEP = 0.1;

// The adjustable rows, in display order: the master volume then the three voiced
// buses (`ambient` has no voices yet, so it isn't listed). `key` selects which
// volume the row reads/writes — 'master' is the master volume, the rest are bus
// keys on AudioPrefs.buses. Master mute is not a row; it toggles via `m` and shows
// as a status line in the shell.
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

// A key resolves to one intent. The shell interprets it against the live mixer, so
// the mapping stays pure (no SoundSystem reference here).
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

// Step the selection by `delta`, clamped to the row range (no wraparound, so the
// list has clear ends like the Shop list).
export function clampSelection(selected: number, delta: number): number {
	return Math.max(0, Math.min(AUDIO_ROWS.length - 1, selected + delta));
}

// A filled/empty block bar plus a percentage, e.g. `█████░░░░░ 50%`.
export function volumeBar(vol: number, width = 10): string {
	const filled = Math.round(vol * width);
	return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(vol * 100)}%`;
}

// One display row: label, the rendered volume bar for its current value, and focus.
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
