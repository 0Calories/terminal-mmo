import { Sprite } from './sprite';

// The heavy brute (ADR 0024 §8): an elite stone bruiser — a broad, hulking Golem
// that fills its footprint far more solidly than the small chaser/shooter, so its
// bulk reads the slow, hard-hitting profile at a glance. Steel-grey stone body (`s`)
// with a pair of glowing (`y`/`k`) eyes. One row taller than the small monsters; the
// renderer plants the bottom row on the same feet line, so the extra bulk rises
// upward without touching the hitbox or the swing telegraph.
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
