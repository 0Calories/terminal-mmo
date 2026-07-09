import type { BodySprite } from '../body-sprite';
import { Sprite } from '../sprite';

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
	baseline: 1,
};
