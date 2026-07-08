import { Sprite } from './sprite';

// The heavy brute (ADR 0024 §8). One row taller than the small monsters; the renderer
// plants the bottom row on the same feet line, so the extra bulk rises upward without
// touching the hitbox or swing telegraph.
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
