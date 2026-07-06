import type { BodySprite } from '../body-sprite';
import { Sprite } from '../sprite';

// The "wisp" Form — a slim, light humanoid build as `FORMS[1]`, the demo's one extra Form
// (the content bill of ADR 0024 §8: 2 Forms total), built on the Form rails of ADR 0020. A
// variation within the shared humanoid body plan — a narrower silhouette centred in the
// frame — NOT a different creature and NOT a different logical box: it keeps the same 9×3
// footprint and `baseline` as every other Form, so the collision box, stats, and combat
// numbers are identical (ADR 0020 §3). Only the art changes. Its slimmer build declares
// its own grip/head anchors (the hand and head sit further in than the broad Forms), the
// per-Form anchor mechanism (ADR 0018 §3) letting a weapon and hat ride any Form for free.
//
// It authors the required core (`idle` + the `walkA`/`walkB` stride, §5) plus the single
// `jump` airborne pose; every other Pose falls back to idle. Feet are ink-top half-blocks
// (`▀`) so `baseline: 1` plants it flush on the terrain line. Authored right-facing — the
// renderer mirrors the grid and the anchors when the Avatar faces left.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
const idle = new Sprite(
	`
··▟██▙···
··▐██▌···
··▀··▀···`,
	{ defaultKey: 'p' },
);

// `walkA` opens the slim stance wide (contact); `walkB` brings the feet together (passing),
// so the distance-driven selector (ADR 0020 §7) animates a light, quick stride. Same 9×3
// footprint as idle.
const walkA = new Sprite(
	`
··▟██▙···
··▐██▌···
·▀····▀··`,
	{ defaultKey: 'p' },
);

const walkB = new Sprite(
	`
··▟██▙···
··▐██▌···
···▀▀····`,
	{ defaultKey: 'p' },
);

// The `jump` Pose holds while airborne (ADR 0020 §6): the shoulders flare into a light
// leaping silhouette distinct from idle and the stride. Same 9×3 footprint, mirrored on facing.
const jump = new Sprite(
	`
·▟▟██▙▙··
··▐██▌···
··▀··▀···`,
	{ defaultKey: 'p' },
);

export const wisp: BodySprite = {
	frames: { idle, walkA, walkB, jump },
	// The slim build's hand and head sit further in than the broad Forms', so this Form
	// declares its own anchors — mirrored across the body on a left facing (ADR 0018 §3).
	grip: { x: 5, y: 1 },
	head: { x: 3, y: 0 },
	// Ink-top contact feet (`▀`): plant the figure flush on the terrain surface cell (ADR 0021).
	baseline: 1,
};
