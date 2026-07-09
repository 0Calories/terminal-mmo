import { Sprite } from './sprite';

const GLYPH = `
┌───┐
│ » │
└─┬─┘
··│··
··┴··`;

const COLORS = `
yyyyy
yyyyy
yyyyy
··w··
··w··`;

export const signpost = new Sprite(GLYPH, { defaultKey: 'w', colors: COLORS });
