import type { BodySprite } from '../body-sprite';
import { player } from '../player';

// The launch humanoid Form — the "buddy" — as `FORMS[0]` (ADR 0020 scope). This slice
// authors ONLY the `idle` Pose, so every selected Pose resolves to `idle` via the
// authoring-contract fallback (§5); walk / jump / combat / emote frames slot in later
// without touching the render path. `idle` reuses the single-frame body grid (which
// `spriteFor('player')` also serves), keeping one source of truth for the rest pose.
//
// The per-Form anchors (ADR 0018 §3): `grip` is the leading mid-body hand the weapon
// hangs from; `head` is the top-centre cell the cosmetic hat rides over. Both are
// mirrored across the body when the Avatar faces left.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
export const buddy: BodySprite = {
	frames: { idle: player },
	grip: { x: 7, y: 1 },
	head: { x: 4, y: 0 },
};
