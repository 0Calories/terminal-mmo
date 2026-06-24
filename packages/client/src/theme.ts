// Screen/chrome colours — distinct from sprites/palette.ts, the recolourable
// *art* palette keyed by single-char codes.
import { RGBA } from '@opentui/core';

export const COLORS = {
	bg: RGBA.fromInts(16, 18, 26, 255),
	terrainFg: RGBA.fromInts(70, 82, 104, 255),
	terrainBg: RGBA.fromInts(34, 40, 54, 255),
	transparent: RGBA.fromInts(0, 0, 0, 0),
	hurt: RGBA.fromInts(255, 240, 120, 255),
	melee: RGBA.fromInts(255, 245, 200, 255),
	// The Dodge after-image (ADR 0017 §5): a cool, bright streak — distinct from the
	// warm melee flash — so an evasive hop reads apart from an attack at a glance.
	dodge: RGBA.fromInts(150, 220, 255, 255),
	// Guard brace (ADR 0017 §5): a cool steel bar for a Block, distinct from the warm
	// melee flash so a defensive stance reads apart from an attack at a glance…
	guard: RGBA.fromInts(150, 200, 255, 255),
	// …and a bright near-white for the Parry window + clash, so the high-skill opening
	// pops against the steel Block.
	parry: RGBA.fromInts(245, 250, 255, 255),
	projectile: RGBA.fromInts(255, 120, 80, 255),
	// A Parry-reflected shot, now owned by the Player and flying back at the shooter
	// (ADR 0017 §8): recoloured to the bright Parry near-white so it reads as "yours"
	// at a glance, distinct from a hostile warm-orange pebble.
	projectileReflected: RGBA.fromInts(245, 250, 255, 255),
	portal: RGBA.fromInts(180, 130, 255, 255),
	vendor: RGBA.fromInts(255, 200, 90, 255),
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
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
	// Over-head emote glyph (#38): a bright, high-contrast reaction on the telegraph
	// layer, drawn above all Sprites and self-clearing.
	emote: RGBA.fromInts(255, 220, 110, 255),
};
