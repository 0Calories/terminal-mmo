import { Sprite } from './sprite';

// `·` = transparent; `\\` is one literal backslash, `` \` `` one literal backtick.
const GLYPH = `
·,---.·
·|x x|·
( >w< )
·\`-v-'·
·/   \\·
`;

export const chaser = new Sprite(GLYPH, { defaultKey: 'm' });
