import { Sprite } from '../sprite';
import type { WeaponSprite } from '../weapon-sprite';

// The default Warrior Sword's appearance (ADR 0018). A held one-hander, posed
// upright at the side at rest: a steel blade rising from a dark guard, the guard
// cell being the grip the hand wraps. Authored right-facing; the renderer mirrors
// it (and the grip column) when the Avatar faces left.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.

const GLYPH = `
▐▌
▟▙
▝▘`;

const COLORS = `
ss
ss
kk`;

const idle = new Sprite(GLYPH, {
	defaultKey: 's',
	colors: COLORS,
});

export const sword: WeaponSprite = {
	frames: { idle },
	// Bottom cell of the art (the guard) sits in the hand: aligned to the body grip.
	grip: { x: -1, y: 2 },
	// Steel — the rarity-ready accent channel (today a hand-authored colour key).
	accent: 's',
};
