import { Sprite } from './sprite';

// "Claude-buddy" Avatar: rounded, bottom-heavy, two dark eye-dots, four feet.
// Symmetric, so both facings match. The `colors` grid darkens the eye cells
// (`k`); every other cell falls back to the body key (`p`).
const GLYPH = `
·▐▛███▜▌·
▝▜█████▛▘
··▘▘·▝▝··`;

const COLORS = `
·ppppppp·
ppppppppp
··pp·pp··`;

export const player = new Sprite(GLYPH, { defaultKey: 'p', colors: COLORS });
