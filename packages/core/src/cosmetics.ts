import { HUES, NAMEPLATE_COLORS } from './sceneStyle';
import { FORM_COUNT } from './sprites';
import type { Cosmetics } from './types';

export type { Cosmetics };

export const DEFAULT_COSMETICS: Cosmetics = {
	hue: 0,
	hat: '',
	nameplate: 0,
	form: 0,
};

export const HUE_COUNT = HUES.length;
export const NAMEPLATE_COUNT = NAMEPLATE_COLORS.length;

// The FROZEN order of the pre-migration render-side HATS array (None, Cap, Crown,
// Wizard, Top Hat, Party Hat). Exists solely to migrate numeric-hat Saves written
// before ADR 0031 into sprite ids — never reorder this. Droppable after one release.
export const LEGACY_HAT_IDS: readonly string[] = [
	'',
	'cap',
	'crown',
	'wizard',
	'top-hat',
	'party-hat',
];

function clampIndex(v: number, count: number): number {
	return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
}

export function clampCosmetics(c: Cosmetics): Cosmetics {
	return {
		hue: clampIndex(c.hue, HUE_COUNT),
		hat: typeof c.hat === 'string' ? c.hat : '',
		nameplate: clampIndex(c.nameplate, NAMEPLATE_COUNT),
		form: clampIndex(c.form, FORM_COUNT),
	};
}

// Set-membership validation is NOT core's job: the server sanitizes against the
// scanned hat id set, and the renderer falls back to no hat on a dangling id.
export function sanitizeHatId(id: unknown, valid: ReadonlySet<string>): string {
	return typeof id === 'string' && valid.has(id) ? id : '';
}

export function randomCosmetics(
	seed: number,
	hatIds: readonly string[] = [],
): Cosmetics {
	let s = seed | 0 || 1;
	const next = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) % 1_000_000;
	};
	const hatPool = ['', ...hatIds];
	// Draw form last so the hue/hat/nameplate sequence stays stable.
	return {
		hue: next() % HUE_COUNT,
		hat: hatPool[next() % hatPool.length],
		nameplate: next() % NAMEPLATE_COUNT,
		form: next() % FORM_COUNT,
	};
}
