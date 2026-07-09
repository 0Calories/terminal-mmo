import { Sprite } from './sprite';

const GLYPH = `
·▟███▙·
▐█▀█▀█▌
▟█████▙
██████▙
▐█▌·▐█▌
·▀▀·▀▀·`;

const COLORS = `
·sssss·
ssykyss
sssssss
sssssss
sss·sss
·ss·ss·`;

export const brute = new Sprite(GLYPH, { defaultKey: 's', colors: COLORS });
