import { Sprite } from './sprite';

// The redesigned humanoid body — the "buddy" — at rest (ADR 0020). This is the new
// Avatar `idle` Pose, drawn through the `bodyFrame` selector as `FORMS[0]`'s idle.
// 9×3 keeps the current footprint (the logical ~1×2 box is unchanged), so world-scale
// and platforming are untouched; only the art changes. Authored right-facing — the
// renderer mirrors it (and the per-Form grip/head anchors) when the Avatar faces left.
//
// Kept under `spriteFor('player')` as the single-frame stand-in any non-render
// consumer needs (overhead-box / nameplate sizing, the death-gore tint), while the
// animated body itself rides the `BodySprite` frame set in `sprites/forms/buddy.ts`.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
const GLYPH = `
·▐██▜█▜▌·
▝▜█████▛▘
··▄···▄··`;

export const player = new Sprite(GLYPH, { defaultKey: 'p' });
