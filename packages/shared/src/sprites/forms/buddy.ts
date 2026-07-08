import type { BodySprite } from '../body-sprite';
import { player } from '../player';
import { Sprite } from '../sprite';

// The launch humanoid Form as `FORMS[0]` (ADR 0020). `idle` reuses the single-frame
// player grid, keeping one source of truth for the rest pose; walk/jump animate the feet
// row. Unauthored Poses fall back to idle.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
const walkA = new Sprite(
	`
·▐██▜█▜▌·
▝▜█████▛▘
·▀·····▀·`,
	{ defaultKey: 'p' },
);

const walkB = new Sprite(
	`
·▐██▜█▜▌·
▝▜█████▛▘
···▀·▀···`,
	{ defaultKey: 'p' },
);

const jump = new Sprite(
	`
▗▟██▜█▜▌·
·▐█████▛▘
 ▀ ·· ·▀·`,
	{ defaultKey: 'p' },
);

// The `wave` emote — the launch `oneshot`: a two-frame sweep sampled by `emoteT` (ADR 0020 §8/§9).
const waveA = new Sprite(
	`
▗▟██▜█▜▌·
·▐█████▛▘
··▀···▀··`,
	{ defaultKey: 'p' },
);

const waveB = new Sprite(
	`
·▐██▜█▜▌·
▝▜█████▛▘
··▀···▀··`,
	{ defaultKey: 'p' },
);

// The `dance` emote — the launch `loop`: no duration, cycles until the Avatar moves or
// fights (ADR 0020 §6/§9).
const danceA = new Sprite(
	`
▗▟██▜█▜▙▖
·▜█████▛·
···▀▀····`,
	{ defaultKey: 'p' },
);

const danceB = new Sprite(
	`
·▐██▜█▜▌·
▟▜█████▛▙
·▀·····▀·`,
	{ defaultKey: 'p' },
);

// The `sit` emote — the launch `hold`: a single sustained Pose held until the Avatar
// moves or fights (ADR 0020 §6/§9).
const sit = new Sprite(
	`
·▐██▜█▜▌·
 ▀█████▙▄
·········`,
	{ defaultKey: 'p' },
);

export const buddy: BodySprite = {
	frames: {
		idle: player,
		walkA,
		walkB,
		jump,
		'emote:wave': [waveA, waveB],
		'emote:dance': [danceA, danceB],
		'emote:sit': sit,
	},
	grip: { x: 7, y: 1 },
	head: { x: 4, y: 0 },
	// Ink-top half-block feet (`▀`) drop one cell; the renderer lowers that cell's ground to
	// `▄` so the boot rests on the line via per-cell compositing (ADR 0021).
	baseline: 1,
};
