import { Sprite } from './sprite';

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
