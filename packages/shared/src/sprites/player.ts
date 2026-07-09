import { Sprite } from './sprite';

const GLYPH = `
·▐██▜█▜▌·
▝▜█████▛▘
··▀···▀··`;

export const player = new Sprite(GLYPH, { defaultKey: 'p' });
