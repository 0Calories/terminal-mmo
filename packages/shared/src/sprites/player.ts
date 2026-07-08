import { Sprite } from './sprite';

// The buddy body at rest — the single-frame stand-in `spriteFor('player')` serves for
// non-render consumers (box/nameplate sizing, death-gore tint), while the animated body
// rides the BodySprite frame set in `sprites/forms/buddy.ts` (ADR 0020).
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
const GLYPH = `
·▐██▜█▜▌·
▝▜█████▛▘
··▀···▀··`;

export const player = new Sprite(GLYPH, { defaultKey: 'p' });
