import { Sprite } from './sprite';

// Block-art Monster: a low gnashing maw — wide toothy jaw under two glowing eyes,
// clawed corners. The `colors` grid tints the eye cells green (`g`); every other
// cell falls back to `m`.
const GLYPH = `
▚·▟▙·▞·
▟████▙·
▞▛▛▛▛▌·
▐▟▟▟▟▖·
▞····▚·`;

const COLORS = `
·······
·g··g··
·······
·······
·······`;

export const chaser = new Sprite(GLYPH, { defaultKey: 'm', colors: COLORS });
