import { Sprite } from './sprite';

// A wooden directional signpost — a read-only NPC that nudges Players toward the
// Fields (PRD story 9). A board on a post; unlike the Merchant it never opens a
// shop, it just shows its directional dialogue when read.
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
