// Sprite design gallery — every candidate Avatar / Monster design explored so
// far, kept as real `Sprite` instances so they render through the live engine
// and palette (and exercise the block-glyph mirror support). This is a
// decision aid, NOT wired into the entity REGISTRY: the live player/chaser are
// unchanged until we pick winners. Preview them with:
//
//     bun packages/client/src/sprites/preview.ts
//
// Authoring: `·` = transparent, `\\` = one backslash, `` \` `` = one backtick
// (template-literal rules). Block-art figures use Block Elements (U+2580–259F);
// their colours come from the optional `colors` grid (one palette key per cell).
import { Sprite } from './sprite';

export interface GalleryEntry {
	category: 'Player' | 'Chaser' | 'Shooter';
	label: string;
	note: string;
	sprite: Sprite;
}

// ============================= PLAYER (Avatar) =============================

const playerCurrent = new Sprite(
	`
··___··
·/o o\\·
( -.- )
·\\___/·
·/   \\·`,
	{ defaultKey: 'p' },
);

// Line-art explorations (the first round).
const playerWarrior = new Sprite(
	`
·,vvv.·
·|o-o|·
(/|H|\\)
·\\===/·
·_J·L_·`,
	{
		defaultKey: 'p',
		colors: `
·eeeee·
·sippi·
ppiiipp
·ppppp·
·ii·ii·`,
	},
);

const playerMascot = new Sprite(
	`
·.---.·
·|o o|·
·\\·u·/·
(·===·)
·/···\\·`,
	{
		defaultKey: 'p',
		colors: `
·sssss·
·seees·
·sssss·
psssssp
·ii·ii·`,
	},
);

// Block-art (the Claude direction). Small 7×5 variants…
const playerBlob = new Sprite(
	`
·▄███▄·
▐█████▌
▐█████▌
·▜███▛·
·▐▌·▐▌·`,
	{ defaultKey: 'p' },
);

const playerSpark = new Sprite(
	`
·▖·█·▗·
·▝▟█▙▘·
▐▌███▐▌
·▗▜█▛▖·
·▘·█·▝·`,
	{ defaultKey: 'p' },
);

// …and the larger, more detailed creature.
const playerBuddy = new Sprite(
	`
····▗█▖····
··▗▟███▙▖··
·▗███████▖·
·█████████·
·█████████·
·▝███████▘·
··▄█▀▀▀█▄··
··██···██··`,
	{
		defaultKey: 'p',
		colors: `
···········
···········
···········
··ee···ee··
··ee···ee··
···········
···········
···········`,
	},
);

// ============================= CHASER (melee) =============================

const chaserCurrent = new Sprite(
	`
·,---.·
·|x x|·
( >w< )
·\`-v-'·
·/   \\·`,
	{ defaultKey: 'm' },
);

const chaserSnapper = new Sprite(
	`
·^···^·
(O···O)
{>VVV<}
·\\WWW/·
·d·d·d·`,
	{
		defaultKey: 'm',
		colors: `
·g···g·
mgmmmgm
kmmmmmk
·kkkkk·
·k·k·k·`,
	},
);

const chaserWisp = new Sprite(
	`
·.---.·
(o___o)
·)WWW(·
··\\m/··
···v···`,
	{
		defaultKey: 'm',
		colors: `
·mmmmm·
gmmmmmg
·kkkkk·
··mmm··
···m···`,
	},
);

const chaserGlitch = new Sprite(
	`
▚·▗█▖·▞
▗█████▖
▐▙▟█▙▟▌
▗▀▜█▛▀▖
▚▝···▘▞`,
	{
		defaultKey: 'm',
		colors: `
·······
·······
··g·g··
·······
·······`,
	},
);

const chaserBiter = new Sprite(
	`
··▟▖·▟▙·▗▙··
▗██████████▖
████████████
████████████
▜██████████▛
▄██████████▄
▘▘▘▘▘▘▝▝▝▝▝▝`,
	{
		defaultKey: 'm',
		colors: `
············
············
·gg······gg·
·gg······gg·
············
············
············`,
	},
);

const chaserCrawler = new Sprite(
	`
·▞·▄████▄·▚·
▝·▟██████▙·▘
·▟████████▙·
·▜████████▛·
▄▗███▘▝███▖▄
▞▐██▝▖▗▘██▌▚
·▞·▝▖··▗▘·▚·`,
	{
		defaultKey: 'm',
		colors: `
············
············
··gg····gg··
············
············
············
············`,
	},
);

// ============================= SHOOTER (ranged) ===========================
// Currently the live registry aliases shooter → chaser art (TODO #4). This is
// the proposed distinct, floating one-eyed caster.

const shooterSentinel = new Sprite(
	`
····▟▙····
··▄████▄··
▗████████▖
▜████████▛
·▀██████▀·
···▀▜▛▀···
···▗▘▝▖···`,
	{
		defaultKey: 'u',
		colors: `
··········
··········
···aaaa···
···aaaa···
··········
··········
··········`,
	},
);

// ★ = current recommendation for that slot.
export const GALLERY: GalleryEntry[] = [
	{
		category: 'Player',
		label: 'current',
		note: 'live sprite — line-art blob',
		sprite: playerCurrent,
	},
	{
		category: 'Player',
		label: 'warrior (line)',
		note: 'helmeted, Warrior-class read',
		sprite: playerWarrior,
	},
	{
		category: 'Player',
		label: 'mascot+ (line)',
		note: 'friendly line face + arms',
		sprite: playerMascot,
	},
	{
		category: 'Player',
		label: 'blob (block 7×5)',
		note: 'small rounded Claude blob',
		sprite: playerBlob,
	},
	{
		category: 'Player',
		label: 'spark (block 7×5)',
		note: 'the Claude starburst mark',
		sprite: playerSpark,
	},
	{
		category: 'Player',
		label: 'buddy (block 11×8) ★',
		note: 'big rounded creature, cyan eyes',
		sprite: playerBuddy,
	},
	{
		category: 'Chaser',
		label: 'current',
		note: 'live sprite — line-art critter',
		sprite: chaserCurrent,
	},
	{
		category: 'Chaser',
		label: 'snapper (line)',
		note: 'fanged ground biter',
		sprite: chaserSnapper,
	},
	{
		category: 'Chaser',
		label: 'wisp (line)',
		note: 'floating skull',
		sprite: chaserWisp,
	},
	{
		category: 'Chaser',
		label: 'glitch (block 7×5)',
		note: 'small spiked burst',
		sprite: chaserGlitch,
	},
	{
		category: 'Chaser',
		label: 'biter (block 12×7)',
		note: 'armoured spiky bug',
		sprite: chaserBiter,
	},
	{
		category: 'Chaser',
		label: 'crawler (block 12×7) ★',
		note: 'domed shell + skittering legs',
		sprite: chaserCrawler,
	},
	{
		category: 'Shooter',
		label: 'eye sentinel (block 10×7) ★',
		note: 'floating one-eyed caster',
		sprite: shooterSentinel,
	},
];
