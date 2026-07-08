// Avatar cosmetic customization (#35, ADR 0003): decorative choices (body hue, hat,
// nameplate colour, Form), each an index into a fixed catalog. Indices, not colours/art,
// travel on the wire so the catalog stays the source of truth. The catalogs live in
// sceneStyle.ts (colour) and sprites/hats.ts (art); this module owns the index logic.

import { HUES, NAMEPLATE_COLORS } from './sceneStyle';
import { FORMS } from './sprites/body-sprite';
import { HATS } from './sprites/hats';
import type { Cosmetics } from './types';

// `Cosmetics` is declared in types.ts so Entity can carry it without an import cycle;
// this module owns the catalogs + logic.
export type { Cosmetics };

// Every index 0 — the default look, and the fallback for a bad wire value.
export const DEFAULT_COSMETICS: Cosmetics = {
	hue: 0,
	hat: 0,
	nameplate: 0,
	form: 0,
};

// Catalog counts (valid index range [0, count)). Exported so the picker and tests can
// enumerate options without reaching into the underlying modules.
export const HUE_COUNT = HUES.length;
export const HAT_COUNT = HATS.length;
export const NAMEPLATE_COUNT = NAMEPLATE_COLORS.length;
export const FORM_COUNT = FORMS.length;

// A whole index in [0, count); anything else (negative, fractional, NaN, out of range)
// collapses to 0 so a decoded/forward-version value can't produce a bad lookup.
function clampIndex(v: number, count: number): number {
	return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
}

// Coerce untrusted cosmetic indices into valid ones at the trust boundary, each bad field
// falling back to its default.
export function clampCosmetics(c: Cosmetics): Cosmetics {
	return {
		hue: clampIndex(c.hue, HUE_COUNT),
		hat: clampIndex(c.hat, HAT_COUNT),
		nameplate: clampIndex(c.nameplate, NAMEPLATE_COUNT),
		form: clampIndex(c.form, FORM_COUNT),
	};
}

// A deterministic cosmetic set from a 32-bit seed — a distinct look for a connecting
// Avatar before the picker (#35). No global RNG, so it's reproducible; the caller supplies
// the seed.
export function randomCosmetics(seed: number): Cosmetics {
	// xorshift32: a tiny, dependency-free integer PRNG. One decorrelated draw per index.
	let s = seed | 0 || 1;
	const next = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) % 1_000_000;
	};
	// `form` is drawn last so the hue/hat/nameplate sequence is unchanged. FORMS currently
	// holds a single shippable Form, so this draw always lands on it.
	return {
		hue: next() % HUE_COUNT,
		hat: next() % HAT_COUNT,
		nameplate: next() % NAMEPLATE_COUNT,
		form: next() % FORM_COUNT,
	};
}
