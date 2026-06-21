// Sprite design gallery — candidate Avatar/Monster designs as real `Sprite`
// instances (so they render through the live machinery, palette, and mirror).
// Decision aid only, NOT wired into the entity REGISTRY (`index.ts`). Preview:
//     bun packages/client/src/sprites/preview.ts
// Authoring rules live in sprite.ts.
import { merchant } from './merchant';
import { player } from './player';
import { Sprite } from './sprite';

export interface GalleryEntry {
	category: 'Avatar' | 'Monster';
	label: string;
	note: string;
	sprite: Sprite;
}

// =============================== AVATARS ==================================
// All "humans" (players + friendly NPCs) share the buddy eye trick: eyes are
// NEGATIVE SPACE, the missing quadrant of a `▛`/`▜` pair, never a painted cell
// (painting a second dark cell double-eyes the face). Each is left-right
// symmetric, so both facings render identically.

// Sprout — tiny green blob NPC, no feet, two-leaf bud; eyes are gaps in `▛██▜`.
const sprout = new Sprite(
	`
··▌▐··
▟▛██▜▙
▝▀▀▀▀▘`,
	{ defaultKey: 'f' },
);

// Scout — taller, slimmer explorer under a cyan cap, with two legs.
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

// Sage — hooded mystic, PICKED as the live Town vendor; art now in merchant.ts
// and imported below so the gallery and game can't drift (cf. Buddy ← player.ts).

// Knight — broad helmeted guard, red crest, visor brow for eyes, two armoured legs.
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

// =============================== MONSTERS =================================

// Slime — low-level blob; rounded dome, two dark eyes, pale shine up top.
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

// Mushroom — spotted red cap over a tan face, two dark eyes, stub feet.
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

// Bat — cave flier: spread wings, small body, green glowing eyes; all dark so the eyes pop.
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

// Ghost — drifting spectre: rounded sheet body, hollow eyes, wavy cyan hem.
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

// Spider — bulbous body, two green eyes, four splayed legs (slashes mirror with facing).
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

// Golem — heavy elite bruiser: blocky stone torso, glowing eyes, stubby legs.
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

// Sentry Eye — floating ranged threat (fits the `shooter` archetype, #4): one
// great eye, black pupil ringed by green iris.
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
