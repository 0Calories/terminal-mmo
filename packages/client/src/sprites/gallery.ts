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
	{ category: 'Avatar', label: 'Buddy', note: 'live base Avatar (player.ts)', sprite: player },
	{ category: 'Monster', label: 'Slime', note: 'low-level blob, dark eyes', sprite: slime },
	{ category: 'Monster', label: 'Mushroom', note: 'spotted cap, stub feet', sprite: mushroom },
	{ category: 'Monster', label: 'Bat', note: 'cave flier, glowing eyes', sprite: bat },
	{ category: 'Monster', label: 'Ghost', note: 'drifting spectre, cyan hem', sprite: ghost },
	{ category: 'Monster', label: 'Spider', note: 'four mirrored legs', sprite: spider },
	{ category: 'Monster', label: 'Golem', note: 'elite stone bruiser', sprite: golem },
	{ category: 'Monster', label: 'Sentry Eye', note: 'ranged (shooter) candidate', sprite: sentryEye },
];
