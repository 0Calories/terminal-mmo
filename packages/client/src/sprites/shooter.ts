import { Sprite } from './sprite';

// Block-art ranged Monster: a hovering, rounded turret with a side barrel —
// deliberately distinct from the chaser's low, wide maw so the two read apart
// at a glance (CONTEXT: Monster; story 19). Block Elements (U+2580–259F) flip
// correctly via Sprite's block-aware mirror, so the barrel swaps sides with
// facing. The `colors` grid tints the eyes green (`g`) and the barrel gold
// (`y`); every other cell falls back to the body key `m`.
const GLYPH = `
·▄██▄··
▟████▙·
██████▖
▜████▛·
·▀▀▀▀··`;

const COLORS = `
·······
··gg···
·····y·
·······
·······`;

export const shooter = new Sprite(GLYPH, { defaultKey: 'm', colors: COLORS });
