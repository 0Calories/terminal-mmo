import { Sprite } from './sprite';

const GLYPH = `
·▗▄▄▄▖·
▟█████▙
██▟█▙██
▜█████▛
·▝▀▀▀▘·`;

const COLORS = `
·ooooo·
oogggoo
oggkggo
oogggoo
·ooooo·`;

export const shooter = new Sprite(GLYPH, { defaultKey: 'o', colors: COLORS });
