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
	// The unarmed attack telegraph: the warm flash an entity with NO equipped weapon
	// (a Monster) paints for its swing tip, and a class skill's hitbox flash. A weaponed
	// swing is coloured by its per-weapon accent instead (ADR 0018 §6) — there is no
	// global "melee" swing colour any more.
	telegraph: RGBA.fromInts(255, 245, 200, 255),
	// The Dodge after-image (ADR 0017 §5): a cool, bright streak — distinct from the
	// warm telegraph flash — so an evasive hop reads apart from an attack at a glance.
	dodge: RGBA.fromInts(150, 220, 255, 255),
	// Guard brace (ADR 0017 §5): a cool steel bar for a Block, distinct from the warm
	// telegraph flash so a defensive stance reads apart from an attack at a glance.
	guard: RGBA.fromInts(150, 200, 255, 255),
	projectile: RGBA.fromInts(255, 120, 80, 255),
	portal: RGBA.fromInts(180, 130, 255, 255),
	vendor: RGBA.fromInts(255, 200, 90, 255),
	// A signpost's directional nudge text (PRD story 9) — a warm wood amber, kin to
	// the vendor gold but calmer, so a read sign reads apart from a shop prompt.
	signpost: RGBA.fromInts(214, 176, 120, 255),
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
	// XP bar fill (#243): a bright cyan-blue, cool against the warm vendor gold and the
	// green HP bar so the HUD vitals read apart at a glance.
	xp: RGBA.fromInts(120, 170, 255, 255),
	dim: RGBA.fromInts(150, 156, 168, 255),
	chat: RGBA.fromInts(120, 200, 235, 255),
	// Over-head Speech bubble (#59, ADR 0007), ADR 0016: the frame + tail float over a
	// transparent background (no square stamp, no corner bleed), the interior padding is
	// a `▒` frosted shade so terrain reads through, and bright text sits on a ~50% dark
	// backing for legibility. `bubbleBg` is that behind-text backing; `bubbleShade` is the
	// opaque dark the `▒` glyph is drawn in — both blend to the same ~[45,53,69] over
	// terrain, so padding and text read as one uniform frosted surface.
	bubbleFg: RGBA.fromInts(236, 236, 242, 255),
	bubbleBorder: RGBA.fromInts(120, 200, 235, 255),
	bubbleBg: RGBA.fromInts(20, 24, 34, 128),
	bubbleShade: RGBA.fromInts(20, 24, 34, 255),
};

// Rarity → screen colour for the in-world Drop glyph + its floating pickup label (#238),
// resolved once from the shared RARITY_COLOR so the terminal reads the exact tier the sim
// rolled — the core visual language of loot (CONTEXT.md, Item), single-sourced so client
// and sim can never drift.
export const RARITY_RGBA: Record<Rarity, RGBA> = Object.fromEntries(
	(
		Object.entries(RARITY_COLOR) as [
			Rarity,
			{ r: number; g: number; b: number },
		][]
	).map(([rarity, c]) => [rarity, RGBA.fromInts(c.r, c.g, c.b, 255)]),
) as Record<Rarity, RGBA>;
