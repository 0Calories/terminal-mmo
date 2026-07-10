import { HUES, NAMEPLATE_COLORS } from './sceneStyle';
import type { Cosmetics } from './types';

export type { Cosmetics };

// Every Avatar has a Form (unlike hat, which can be '' = none). 'buddy' was
// index 0 and the only shipped Form before ADR 0031.
export const DEFAULT_FORM_ID = 'buddy';

export const DEFAULT_COSMETICS: Cosmetics = {
	hue: 0,
	hat: '',
	nameplate: 0,
	form: DEFAULT_FORM_ID,
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

// The FROZEN order of the pre-migration render-side FORMS array (only 'buddy'
// ever shipped as a selectable Form; 'wisp' was drafted but never selectable).
// Exists solely to migrate numeric-form Saves written before ADR 0031 into sprite
// ids — never reorder this. Droppable after one release.
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

// Set-membership validation is NOT core's job: the server sanitizes against the
// scanned hat id set, and the renderer falls back to no hat on a dangling id.
export function sanitizeHatId(id: unknown, valid: ReadonlySet<string>): string {
	return typeof id === 'string' && valid.has(id) ? id : '';
}

// Like sanitizeHatId, but a Form is never empty: an unknown id collapses to the
// default Form ('buddy'), not ''.
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
	// Draw form last so the hue/hat/nameplate sequence stays stable.
	return {
		hue: next() % HUE_COUNT,
		hat: hatPool[next() % hatPool.length],
		nameplate: next() % NAMEPLATE_COUNT,
		form: formPool[next() % formPool.length],
	};
}
