// Avatar cosmetic customization (#35, PRD story 7/8; ADR 0003). An Avatar carries
// three independent, purely-decorative choices — a body hue, one cosmetic hat
// (separate from gear), and a nameplate colour — each a small integer index into a
// fixed, reviewed catalog. Indices (not colours/art) travel on the wire so a frame
// costs 3 bytes and the catalog stays the single source of truth, shared by client
// and server. The catalogs themselves live where their data naturally belongs:
// hues / nameplate colours in sceneStyle.ts (colour data), hats in sprites/hats.ts
// (art); this module owns the type, the defaults, and the index logic.

import { HUES, NAMEPLATE_COLORS } from './sceneStyle';
import { FORMS } from './sprites/body-sprite';
import { HATS } from './sprites/hats';
import type { Cosmetics } from './types';

// `Cosmetics` is declared in types.ts (the dependency-free base module) so Entity
// can carry it without an import cycle; this module owns the catalogs + logic.
export type { Cosmetics };

// The bareheaded, default-amber, grey-nameplate look (every index 0). What an
// Avatar shows before any choice is made and the fallback for a bad wire value.
export const DEFAULT_COSMETICS: Cosmetics = {
	hue: 0,
	hat: 0,
	nameplate: 0,
	form: 0,
};

// Counts of each catalog (the valid index range is [0, count)). Exported so the
// (later) picker and tests can enumerate the options without reaching into the
// underlying modules.
export const HUE_COUNT = HUES.length;
export const HAT_COUNT = HATS.length;
export const NAMEPLATE_COUNT = NAMEPLATE_COLORS.length;
export const FORM_COUNT = FORMS.length;

// A whole index in [0, count); anything else (negative, fractional, NaN, past the
// catalog) collapses to 0 — the default — so a decoded or forward-version value can
// never produce an out-of-range lookup.
function clampIndex(v: number, count: number): number {
	return Number.isInteger(v) && v >= 0 && v < count ? v : 0;
}

// Coerce arbitrary (decoded / untrusted) cosmetic indices into valid ones, each bad
// field falling back to its default. The renderer also tolerates a stray index, but
// clamping at the trust boundary keeps the rest of the code total.
export function clampCosmetics(c: Cosmetics): Cosmetics {
	return {
		hue: clampIndex(c.hue, HUE_COUNT),
		hat: clampIndex(c.hat, HAT_COUNT),
		nameplate: clampIndex(c.nameplate, NAMEPLATE_COUNT),
		form: clampIndex(c.form, FORM_COUNT),
	};
}

// A deterministic pseudo-random cosmetic set from a 32-bit seed — used to give a
// connecting Avatar a distinct look before the pre-spawn picker exists (#35: "may
// be defaulted or randomized at connect"). Pure (no global RNG) so it is testable
// and reproducible; the caller supplies the seed (e.g. a per-connect random int).
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
	// holds a single shippable Form (Form 2/wisp drafted out pending art rework), so this
	// draw always lands on it; re-adding `wisp` to FORMS restores a varied Form here.
	return {
		hue: next() % HUE_COUNT,
		hat: next() % HAT_COUNT,
		nameplate: next() % NAMEPLATE_COUNT,
		form: next() % FORM_COUNT,
	};
}
