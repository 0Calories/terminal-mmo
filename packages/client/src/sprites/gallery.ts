// Candidate sprite designs, NOT wired into the entity REGISTRY. Preview with:
//     bun packages/client/src/sprites/preview.ts
import { Sprite, spriteFor, spriteForNpc } from '@mmo/shared';

// The live Avatar/vendor art lives in @mmo/shared's registry; pull it through the
// lookup so the gallery and game can't drift.
const player = spriteFor('player');
const merchant = spriteForNpc('vendor');

export interface GalleryEntry {
	category: 'Avatar' | 'Monster';
	label: string;
	note: string;
	sprite: Sprite;
}

// Humanoid eyes are negative space (the gap in a `▛`/`▜` pair) — painting an
// explicit dark eye cell double-eyes the face.
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

// Sage was picked as the live vendor; its art lives in merchant.ts (imported
// above) so the gallery and game can't drift. Same for Buddy ← player.ts.
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

const golem = new Sprite(
	`
·▟███▙·
▐█▀█▀█▌
▟█████▙
██████▙
▐█▌·▐█▌
·▀▀·▀▀·`,
	{
		defaultKey: 's',
		colors: `
·sssss·
ssykyss
sssssss
sssssss
sss·sss
·ss·ss·`,
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
		note: 'elite stone bruiser',
		sprite: golem,
	},
	{
		category: 'Monster',
		label: 'Sentry Eye',
		note: 'ranged (shooter) candidate',
		sprite: sentryEye,
	},
];
