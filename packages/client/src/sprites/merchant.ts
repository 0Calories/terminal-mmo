import { Sprite } from './sprite';

// Merchant — the Town vendor NPC's Avatar (PRD story 29). This is the design
// gallery's "Sage": a bell-shaped robe narrowing to a pointed hood and widening
// to a hem — off-white cloth cinched by a cyan sash — the "wise shopkeeper"
// silhouette, distinct from the orange player buddy. The eyes are negative space
// (the gap in the `▛██▜` brow), never a painted cell. Left-right symmetric, so
// both facings render identically. Promoted here from a gallery proposal to live
// art (cf. player.ts); gallery.ts imports it so the two never diverge.
const GLYPH = `
··▟▙··
·▟██▙·
▟▛██▜▙
██████
▝████▘`;

const COLORS = `
··oo··
·oooo·
oooooo
cccccc
·oooo·`;

export const merchant = new Sprite(GLYPH, { defaultKey: 'o', colors: COLORS });
