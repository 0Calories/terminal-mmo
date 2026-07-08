import { Sprite } from './sprite';

// A read-only signpost NPC — unlike the Merchant it never opens a shop, just shows its
// directional dialogue (PRD story 9).
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
