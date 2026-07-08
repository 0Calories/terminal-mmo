import type { BodySprite } from '../body-sprite';
import { Sprite } from '../sprite';

// The "wisp" Form as `FORMS[1]` (ADR 0024 §8) — a slimmer humanoid on the ADR 0020 rails.
// Same 9×3 footprint and box as every Form, so combat numbers are identical (§3); only the
// art changes, and it declares its own grip/head anchors for the narrower build (ADR 0018 §3).
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
const idle = new Sprite(
	`
··▟██▙···
··▐██▌···
··▀··▀···`,
	{ defaultKey: 'p' },
);

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

const jump = new Sprite(
	`
·▟▟██▙▙··
··▐██▌···
··▀··▀···`,
	{ defaultKey: 'p' },
);

export const wisp: BodySprite = {
	frames: { idle, walkA, walkB, jump },
	grip: { x: 5, y: 1 },
	head: { x: 3, y: 0 },
	// Ink-top contact feet (`▀`): plant the figure flush on the terrain surface cell (ADR 0021).
	baseline: 1,
};
