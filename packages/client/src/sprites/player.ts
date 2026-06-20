import { Sprite } from './sprite';

// `·` = transparent; `\\` is one literal backslash (template-literal escape).
const GLYPH = `
··___··
·/o o\\·
( -.- )
·\\___/·
·/   \\·
`;

export const player = new Sprite(GLYPH, { defaultKey: 'p' });
