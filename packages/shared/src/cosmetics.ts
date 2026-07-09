import { HUES, NAMEPLATE_COLORS } from './sceneStyle';
import { FORMS } from './sprites/body-sprite';
import { HATS } from './sprites/hats';
import type { Cosmetics } from './types';

export type { Cosmetics };

export const DEFAULT_COSMETICS: Cosmetics = {
	hue: 0,
	hat: 0,
	nameplate: 0,
	form: 0,
};

export const HUE_COUNT = HUES.length;
export const HAT_COUNT = HATS.length;
export const NAMEPLATE_COUNT = NAMEPLATE_COLORS.length;
export const FORM_COUNT = FORMS.length;

function clampIndex(v: number, count: number): number {
	return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
}

export function clampCosmetics(c: Cosmetics): Cosmetics {
	return {
		hue: clampIndex(c.hue, HUE_COUNT),
		hat: clampIndex(c.hat, HAT_COUNT),
		nameplate: clampIndex(c.nameplate, NAMEPLATE_COUNT),
		form: clampIndex(c.form, FORM_COUNT),
	};
}

export function randomCosmetics(seed: number): Cosmetics {
	let s = seed | 0 || 1;
	const next = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) % 1_000_000;
	};
	// Draw form last so the hue/hat/nameplate sequence stays stable.
	return {
		hue: next() % HUE_COUNT,
		hat: next() % HAT_COUNT,
		nameplate: next() % NAMEPLATE_COUNT,
		form: next() % FORM_COUNT,
	};
}
