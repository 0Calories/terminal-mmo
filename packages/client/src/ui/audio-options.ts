import type { AudioPrefs } from '../config';

export const VOLUME_STEP = 0.1;

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

export type AudioAction =
	| { kind: 'move'; delta: number }
	| { kind: 'adjust'; delta: number }
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

export function clampSelection(selected: number, delta: number): number {
	return Math.max(0, Math.min(AUDIO_ROWS.length - 1, selected + delta));
}

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
