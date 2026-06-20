import { Sprite } from './sprite';

// "Claude-buddy" Avatar: a rounded, bottom-heavy creature with two dark eye-dots
// and four little feet. Block Elements (U+2580–259F) read as filled pixels; the
// silhouette and eyes are left-right symmetric, so both facings render
// identically. The `colors` grid darkens the two eye cells (`k`); every other
// cell falls back to the body key (`p`).
const GLYPH = `
·▐▛███▜▌·
▝▜█████▛▘
··▘▘·▝▝··`;

const COLORS = `
·ppppppp·
ppppppppp
··pp·pp··`;

export const player = new Sprite(GLYPH, { defaultKey: 'p', colors: COLORS });
