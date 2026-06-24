import { Sprite } from './sprite';

// The poise-tank (ADR 0017 §6): a squat, heavy, armoured block — visibly bulkier
// than the chaser so its "must be chipped before you can launch it" role reads at a
// glance. Bodied in the dark slate `k` palette code (stone-grey), with bright `s`
// rivets so it scans as plated rather than fleshy.
const GLYPH = `
▟████▙·
███████
█▛██▜█·
███████
▜█···█▛`;

const COLORS = `
·kkkkk·
kkkkkkk
ksk·sk·
kkkkkkk
·k···k·`;

export const tank = new Sprite(GLYPH, { defaultKey: 'k', colors: COLORS });
