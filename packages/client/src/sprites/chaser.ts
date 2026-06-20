import { Sprite } from './sprite';

// Block-art Monster: a low, gnashing maw — a wide toothy jaw under two glowing
// eyes, with little clawed corners. Block Elements (U+2580–259F) read as filled
// pixels and flip correctly via Sprite's block-aware mirror. The `colors` grid
// tints the two eye cells green (`g`); every other cell falls back to `m`.
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
