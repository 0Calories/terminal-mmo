import { Sprite } from './sprite';

// The heavy brute (ADR 0024 §8): a hulking, broad-shouldered bruiser that fills its
// footprint far more solidly than the small chaser/shooter — its bulk reads the slow,
// hard-hitting profile at a glance. Steel-grey body (`s`) with a red (`m`) glare.
const GLYPH = `
·▄███▄·
▟█████▙
███████
▜█████▛
·█▘·▝█·`;

const COLORS = `
·······
··m·m··
·······
·······
·······`;

export const brute = new Sprite(GLYPH, { defaultKey: 's', colors: COLORS });
