// Candidate sprite designs, not wired into the registry. Preview: bun packages/client/src/sprites/preview.ts
import { Sprite, spriteFor, spriteForNpc } from '@mmo/shared';

const player = spriteFor('player');
const merchant = spriteForNpc('vendor');
const golem = spriteFor('brute');

export interface GalleryEntry {
	category: 'Avatar' | 'Monster';
	label: string;
	note: string;
	sprite: Sprite;
}

// Humanoid eyes are negative space — an explicit dark eye cell double-eyes the face.
const sprout = new Sprite(
	`
··▌▐··
▟▛██▜▙
▝▀▀▀▀▘`,
	{ defaultKey: 'f' },
);

const scout = new Sprite(
	`
··▄▄▄··
·▟███▙·
·▐▛█▜▌·
·▝███▘·
··▘·▝··`,
	{
		defaultKey: 'e',
		colors: `
··ccc··
·ccccc·
·eeeee·
·eeeee·
··e·e··`,
	},
);

const knight = new Sprite(
	`
··▟██▙··
·▟████▙·
▟█▛██▜█▙
████████
▝██████▘
·▐█▌▐█▌·`,
	{
		defaultKey: 's',
		colors: `
··mmmm··
·ssssss·
ssssssss
ssssssss
·ssssss·
·ssssss·`,
	},
);

const slime = new Sprite(
	`
·▗▄▄▄▖·
▟█████▙
███████
▝▀▀▀▀▀▘`,
	{
		defaultKey: 'f',
		colors: `
·offff·
fffffff
fkfffkf
·fffff·`,
	},
);

const mushroom = new Sprite(
	`
·▗▟█▙▖·
▟█████▙
▝▀███▀▘
·▐███▌·
··▀·▀··`,
	{
		defaultKey: 'm',
		colors: `
·mmmmm·
mmomomm
wwwwwww
·ekeke·
··e·e··`,
	},
);

const bat = new Sprite(
	`
▙▖·▄·▗▟
·▟███▙·
··▘·▝··`,
	{
		defaultKey: 'k',
		colors: `
kk·k·kk
·kgkgk·
··k·k··`,
	},
);

const ghost = new Sprite(
	`
·▗▄▄▄▖·
▟█████▙
██▀█▀██
▐█████▌
·▚·▚·▚·`,
	{
		defaultKey: 'o',
		colors: `
·ooooo·
ooooooo
ookokoo
ooooooo
·c·c·c·`,
	},
);

const spider = new Sprite(
	`
\\··▄··/
·▟███▙·
/·▀▀▀·\\`,
	{
		defaultKey: 'k',
		colors: `
k··k··k
·kgkgk·
k·kkk·k`,
	},
);

const sentryEye = new Sprite(
	`
·▗▄▄▄▖·
▟█████▙
███████
▜█████▛
·▝▀▀▀▘·`,
	{
		defaultKey: 'o',
		colors: `
·ooooo·
oogggoo
oggkggo
oogggoo
·ooooo·`,
	},
);

export const GALLERY: readonly GalleryEntry[] = [
	{
		category: 'Avatar',
		label: 'Buddy',
		note: 'live base Avatar (player.ts)',
		sprite: player,
	},
	{
		category: 'Avatar',
		label: 'Sprout',
		note: 'tiny round blob, leaf bud',
		sprite: sprout,
	},
	{
		category: 'Avatar',
		label: 'Scout',
		note: 'tall, cyan-capped, legs',
		sprite: scout,
	},
	{
		category: 'Avatar',
		label: 'Merchant',
		note: 'live Town vendor NPC (merchant.ts)',
		sprite: merchant,
	},
	{
		category: 'Avatar',
		label: 'Knight',
		note: 'broad helmeted guard, red crest',
		sprite: knight,
	},
	{
		category: 'Monster',
		label: 'Slime',
		note: 'low-level blob, dark eyes',
		sprite: slime,
	},
	{
		category: 'Monster',
		label: 'Mushroom',
		note: 'spotted cap, stub feet',
		sprite: mushroom,
	},
	{
		category: 'Monster',
		label: 'Bat',
		note: 'cave flier, glowing eyes',
		sprite: bat,
	},
	{
		category: 'Monster',
		label: 'Ghost',
		note: 'drifting spectre, cyan hem',
		sprite: ghost,
	},
	{
		category: 'Monster',
		label: 'Spider',
		note: 'four mirrored legs',
		sprite: spider,
	},
	{
		category: 'Monster',
		label: 'Golem',
		note: 'live brute Monster (brute.ts)',
		sprite: golem,
	},
	{
		category: 'Monster',
		label: 'Sentry Eye',
		note: 'ranged (shooter) candidate',
		sprite: sentryEye,
	},
];
