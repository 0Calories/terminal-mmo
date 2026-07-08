// Screen/chrome colours — distinct from sprites/palette.ts, the recolourable
// *art* palette keyed by single-char codes.
import { RARITY_COLOR, type Rarity } from '@mmo/shared';
import { RGBA } from '@opentui/core';

export const COLORS = {
	bg: RGBA.fromInts(16, 18, 26, 255),
	terrainFg: RGBA.fromInts(70, 82, 104, 255),
	terrainBg: RGBA.fromInts(34, 40, 54, 255),
	transparent: RGBA.fromInts(0, 0, 0, 0),
	hurt: RGBA.fromInts(255, 240, 120, 255),
	// The unarmed attack telegraph (a Monster's swing tip, a skill's hitbox flash). A
	// weaponed swing uses its per-weapon accent instead (ADR 0018 §6).
	telegraph: RGBA.fromInts(255, 245, 200, 255),
	// Dodge after-image (ADR 0017 §5): a cool streak, distinct from the warm telegraph so
	// an evasive hop reads apart from an attack.
	dodge: RGBA.fromInts(150, 220, 255, 255),
	// Guard brace (ADR 0017 §5): a cool steel bar, distinct from the warm telegraph so a
	// Block reads apart from an attack.
	guard: RGBA.fromInts(150, 200, 255, 255),
	projectile: RGBA.fromInts(255, 120, 80, 255),
	portal: RGBA.fromInts(180, 130, 255, 255),
	vendor: RGBA.fromInts(255, 200, 90, 255),
	// Signpost nudge text (PRD story 9): a warm wood amber, calmer than vendor gold so a
	// sign reads apart from a shop prompt.
	signpost: RGBA.fromInts(214, 176, 120, 255),
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
	// XP bar fill (#243): cool cyan-blue against the green HP bar so vitals read apart.
	xp: RGBA.fromInts(120, 170, 255, 255),
	dim: RGBA.fromInts(150, 156, 168, 255),
	// Inline warning / error line (e.g. a rejected Handle, #304): a warm red distinct from
	// the dim hint.
	warn: RGBA.fromInts(255, 120, 90, 255),
	chat: RGBA.fromInts(120, 200, 235, 255),
	// Over-head Speech bubble (#59, ADR 0007/0016): a frosted `▒` shade lets terrain read
	// through, bright text sits on a dark backing. `bubbleBg` is the behind-text backing;
	// `bubbleShade` is the opaque dark the `▒` is drawn in — both blend to the same tone
	// over terrain, so padding and text read as one surface.
	bubbleFg: RGBA.fromInts(236, 236, 242, 255),
	bubbleBorder: RGBA.fromInts(120, 200, 235, 255),
	bubbleBg: RGBA.fromInts(20, 24, 34, 128),
	bubbleShade: RGBA.fromInts(20, 24, 34, 255),
};

// Rarity → screen colour for the Drop glyph + pickup label (#238), resolved once from
// the shared RARITY_COLOR so client and sim can't drift.
export const RARITY_RGBA: Record<Rarity, RGBA> = Object.fromEntries(
	(
		Object.entries(RARITY_COLOR) as [
			Rarity,
			{ r: number; g: number; b: number },
		][]
	).map(([rarity, c]) => [rarity, RGBA.fromInts(c.r, c.g, c.b, 255)]),
) as Record<Rarity, RGBA>;
