import { HUES, NAMEPLATE_COLORS } from './sceneStyle';
import type { Cosmetics } from './types';

export type { Cosmetics };

export const DEFAULT_FORM_ID = 'buddy';

export const DEFAULT_COSMETICS: Cosmetics = {
	hue: 0,
	hat: '',
	nameplate: 0,
	form: DEFAULT_FORM_ID,
};

export const HUE_COUNT = HUES.length;
export const NAMEPLATE_COUNT = NAMEPLATE_COLORS.length;

export const LEGACY_HAT_IDS: readonly string[] = [
	'',
	'cap',
	'crown',
	'wizard',
	'top-hat',
	'party-hat',
];

export const LEGACY_FORM_IDS: readonly string[] = ['buddy'];

function clampIndex(v: number, count: number): number {
	return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
}

export function clampCosmetics(c: Cosmetics): Cosmetics {
	return {
		hue: clampIndex(c.hue, HUE_COUNT),
		hat: typeof c.hat === 'string' ? c.hat : '',
		nameplate: clampIndex(c.nameplate, NAMEPLATE_COUNT),
		form: typeof c.form === 'string' ? c.form : DEFAULT_FORM_ID,
	};
}

export function sanitizeHatId(id: unknown, valid: ReadonlySet<string>): string {
	return typeof id === 'string' && valid.has(id) ? id : '';
}

export function sanitizeFormId(
	id: unknown,
	valid: ReadonlySet<string>,
): string {
	return typeof id === 'string' && valid.has(id) ? id : DEFAULT_FORM_ID;
}

export function randomCosmetics(
	seed: number,
	hatIds: readonly string[] = [],
	formIds: readonly string[] = [DEFAULT_FORM_ID],
): Cosmetics {
	let s = seed | 0 || 1;
	const next = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) % 1_000_000;
	};
	const hatPool = ['', ...hatIds];
	const formPool = formIds.length > 0 ? formIds : [DEFAULT_FORM_ID];

	return {
		hue: next() % HUE_COUNT,
		hat: hatPool[next() % hatPool.length],
		nameplate: next() % NAMEPLATE_COUNT,
		form: formPool[next() % formPool.length],
	};
}
