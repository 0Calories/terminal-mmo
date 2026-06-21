import { Sprite } from './sprite';

// Merchant — Town vendor NPC Avatar (PRD story 29), the gallery's "Sage":
// bell robe, pointed hood, cyan sash. Eyes are negative space (the gap in the
// `▛██▜` brow), never a painted cell. Symmetric, so both facings match.
// gallery.ts imports this so live art and the gallery never diverge.
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
