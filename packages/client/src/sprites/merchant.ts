import { Sprite } from './sprite';

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
