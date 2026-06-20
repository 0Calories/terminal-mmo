import { Sprite } from './sprite';

// Sentry Eye — the live ranged shooter (#4), matching the design-gallery
// candidate: a single great hovering eye, black pupil (`k`) ringed by a green
// iris (`g`) on an off-white body (`o`). Reads instantly as "this one shoots
// at you," and is unmistakable next to the chaser's low, wide maw (story 19).
// Block Elements (U+2580–259F) flip correctly via Sprite's block-aware mirror.
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
