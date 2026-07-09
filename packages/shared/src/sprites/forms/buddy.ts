import type { BodySprite } from '../body-sprite';
import { player } from '../player';
import { Sprite } from '../sprite';

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
	baseline: 1,
};
