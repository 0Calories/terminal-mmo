import { Sprite } from './sprite';

// Claude-style block-art Avatar: a rounded sunburst creature with eye-holes
// (the background shows through) and two little feet. Block Elements
// (U+2580–259F) read as filled pixels; the silhouette is left-right symmetric,
// so both facings render identically.
const GLYPH = `
·▖·█·▗·
·▚███▞·
▗█▟█▙█▖
▝█████▘
·▐▌·▐▌·`;

export const player = new Sprite(GLYPH, { defaultKey: 'p' });
