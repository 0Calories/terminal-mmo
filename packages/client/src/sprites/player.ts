import { Sprite } from './sprite';

const GLYPH = `
·▐▛███▜▌·
▝▜█████▛▘
··▘▘·▝▝··`;

const COLORS = `
·ppppppp·
ppppppppp
··pp·pp··`;

export const player = new Sprite(GLYPH, { defaultKey: 'p', colors: COLORS });
