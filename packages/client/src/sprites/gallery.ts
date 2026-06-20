// Sprite design gallery — proposed new Avatar and Monster designs, kept as real
// `Sprite` instances so they render through the same machinery, palette, and
// block-glyph mirror as the live game. This is a decision aid, NOT wired into
// the entity REGISTRY (`index.ts`): the live player/chaser are untouched until
// winners are picked. Preview every candidate, both facings, in true colour:
//
//     bun packages/client/src/sprites/preview.ts
//
// Authoring rules (see sprite.ts): `·` (U+00B7) marks a transparent cell; a
// literal space is transparent too. Block Elements (U+2580–259F) read as filled
// "pixels" and flip correctly via Sprite's block-aware mirror; brackets and
// slashes mirror too (so a bow or a pose can face front either way). The
// optional `colors` grid must match the glyph grid cell-for-cell; each cell is a
// single-char PALETTE key, with `·`/space falling back to `defaultKey`.
import { player } from './player';
import { Sprite } from './sprite';

export interface GalleryEntry {
	category: 'Avatar' | 'Monster';
	label: string;
	note: string;
	sprite: Sprite;
}

// =============================== AVATARS ==================================
// The base Avatar is decided and lives in `player.ts` (classes deferred —
// CONTEXT.md): a rounded, bottom-heavy "Claude-buddy" with two dark eye-dots and
// four little feet. It's imported here (not redefined) so the gallery shows
// exactly what the game draws. Customization (recolour, hat, nameplate per
// ADR 0003) layers on top of this single template.
//
// The proposals below are all "humans" — players + friendly NPCs — so they share
// the art style (chunky Block-Element pixels) and the buddy's eye trick: the eyes
// are NEGATIVE SPACE, the missing quadrant of a `▛`/`▜` pair, never a painted-on
// cell (painting a second dark cell on the body double-eyes the face). Beyond
// that the silhouettes diverge freely — short and round, tall and capped,
// bell-robed, broad-shouldered — so the cast doesn't read as one recolour
// repeated. Each is left-right symmetric, so both facings render identically.

// Sprout — the smallest, gentlest NPC (starter-town greeter / tutorial guide): a
// rounded little green blob, no feet, with a two-leaf bud poking up. Mono-green,
// eyes are the gaps in the `▛██▜` brow.
const sprout = new Sprite(
	`
··▌▐··
▟▛██▜▙
▝▀▀▀▀▘`,
	{ defaultKey: 'f' },
);

// Scout — an explorer: a taller, slimmer figure than the base buddy under a soft
// cyan cap, with two little legs. The cap is the headgear layer; the lankier body
// reads as "out adventuring," good for a player look or a roving quest-giver.
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

// Sage — a hooded mystic: a bell-shaped robe that narrows to a pointed hood and
// widens to a hem, off-white cloth cinched by a cyan sash. The tall triangular
// silhouette (no feet, no buddy-blob) marks the "wise old NPC" — healer, lore
// vendor, questline anchor.
const sage = new Sprite(
	`
··▟▙··
·▟██▙·
▟▛██▜▙
██████
▝████▘`,
	{
		defaultKey: 'o',
		colors: `
··oo··
·oooo·
oooooo
cccccc
·oooo·`,
	},
);

// Knight — a guard / martial NPC: broad-shouldered and helmeted, a red crest on
// top, a visor brow for the eyes, and two armoured legs. The widest, heaviest
// human silhouette — it should feel like it could block a doorway.
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
// A Field bestiary — readable at sprite scale, distinct silhouettes, eye-glow
// where it sells "alive and hostile."

// Slime — the bread-and-butter low-level blob. Rounded dome, two dark eyes, a
// pale shine highlight up top.
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

// Mushroom — a classic forest critter: spotted red cap over a tan face with two
// dark eyes and little stub feet.
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

// Bat — a cave flier: spread wings, a small body, two green glowing eyes. Tiny
// footprint, all dark so the eyes pop.
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

// Ghost — a drifting spectre: rounded sheet body, dark hollow eyes, a tattered
// wavy hem fading to cyan.
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

// Spider — a skittering ambusher: bulbous body, two green eyes, four splayed
// legs (slashes, which mirror cleanly with facing).
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

// Golem — a heavy bruiser: blocky stone torso, two glowing eyes set in a cracked
// brow, stubby legs. Bigger silhouette signals "elite."
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

// Sentry Eye — a floating ranged threat (fits the `shooter` archetype, #4): a
// single great eye with a black pupil ringed by a green iris, hovering. Reads
// instantly as "this one shoots at you."
const sentryEye = new Sprite(
	`
·▗▄▄▄▖·
▟█████▙
██▟█▙██
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
		label: 'Sage',
		note: 'bell robe + hood, cyan sash',
		sprite: sage,
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
