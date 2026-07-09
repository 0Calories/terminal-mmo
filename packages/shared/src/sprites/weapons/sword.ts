import { Sprite } from '../sprite';
import type { WeaponSprite } from '../weapon-sprite';

const idle = new Sprite(
	`
▐▌
▟▙
▝▘`,
	{ defaultKey: 'a', colors: `\naa\naa\nkk` },
);

const windup = new Sprite(
	`
·▙
·▐▙
··▝▘
`,
	{
		defaultKey: 'a',
		colors: `
·a
·aa
··kk
`,
	},
);

const active1 = new Sprite(
	`
·
▂▙▂▂▂
▔▛▔▔▔
·
`,
	{
		defaultKey: 'a',
		colors: `
·
kaaaa
kaaaa
·
`,
	},
);

export const sword: WeaponSprite = {
	frames: { idle, windup, active: [active1] },
	grip: { x: -1, y: 2 },
	accent: 's',
};
