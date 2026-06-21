import { Sprite } from './sprite';

// Sentry Eye — the live ranged shooter (#4): a single great hovering eye, black
// pupil (`k`) ringed by green iris (`g`) on an off-white body (`o`). Distinct
// from the chaser's low wide maw (story 19).
const GLYPH = `
·▗▄▄▄▖·
▟█████▙
██▟█▙██
▜█████▛
·▝▀▀▀▘·`;

const COLORS = `
·ooooo·
oogggoo
oggkggo
oogggoo
·ooooo·`;

export const shooter = new Sprite(GLYPH, { defaultKey: 'o', colors: COLORS });
