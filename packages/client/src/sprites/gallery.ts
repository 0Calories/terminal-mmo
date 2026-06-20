// Sprite design gallery — every candidate Avatar / Monster design explored so
// far, kept as real `Sprite` instances so they render through the live engine
// and palette (and exercise the block-glyph mirror support). This is a
// decision aid, NOT wired into the entity REGISTRY: the live player/chaser are
// unchanged until we pick winners. Preview them with:
//
//     bun packages/client/src/sprites/preview.ts
//
// The raw exploration scripts these were lifted from live at the repo root as
// scratch_*.mjs (standalone, runnable with `node`).
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

// Block-art (the Claude direction). Early 7×5 passes…
const playerEyehole = new Sprite(
	`
·▖·█·▗·
·▚███▞·
▗█▟█▙█▖
▝█████▘
·▐▌·▐▌·`,
	{ defaultKey: 'p' },
);

const playerRoundBurst = new Sprite(
	`
·▗▟█▙▖·
▗█████▖
▝████▀▘
·▜██▛··
·▐▌▐▌··`,
	{ defaultKey: 'p' },
);

const playerBurstHoles = new Sprite(
	`
·▗▟█▙▖·
▗█████▖
▐▌▐█▌▐▌
·▜██▛··
·▐▌▐▌··`,
	{ defaultKey: 'p' },
);

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

// Block-art passes. Early 7×5…
const chaserCorrupted = new Sprite(
	`
▚·▟▙·▞·
▗▜██▛▖·
▝▙██▟▘·
▞▝██▘▚·
▗▘··▝▖·`,
	{ defaultKey: 'm' },
);

const chaserSpiked = new Sprite(
	`
▚·▟▙·▞·
▗████▖·
▜▄██▄▛·
▗▀██▀▖·
▘▗▛▜▖▝·`,
	{
		defaultKey: 'm',
		colors: `
·······
·······
·g··g··
·······
·······`,
	},
);

const chaserGnasher = new Sprite(
	`
▗▙··▟▖·
▟████▙·
█▄██▄█·
▚▚▚▚▚▘·
▗▘·▝▖··`,
	{
		defaultKey: 'm',
		colors: `
·······
·······
g···g··
·······
·······`,
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

const chaserMaw = new Sprite(
	`
▚·▟▙·▞·
▟████▙·
▞▛▛▛▛▌·
▐▟▟▟▟▖·
▞····▚·`,
	{
		defaultKey: 'm',
		colors: `
·······
·g··g··
·······
·······
·······`,
	},
);

// …and the larger 12×7 brutes.
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

const chaserGlitchBeast = new Sprite(
	`
▚··········▞
·▚·▗▟██▙▖·▞·
·▄████████▄·
▐██████████▌
·▜████████▛·
▘▌▘▌▘▌▐▝▐▝▐▝
·▐·▐·▐▌·▌·▌·`,
	{
		defaultKey: 'm',
		colors: `
············
············
··gg····gg··
··gg····gg··
············
············
············`,
	},
);

const chaserGlitchShard = new Sprite(
	`
▚▗▙·▗▌▐▖·▟▖▞
▗███▙▘▝▟███▖
▜████··████▛
▗███▙··▟███▖
▜████··████▛
▗▜██▚▌▐▞██▛▖
▘·▌▌·▘▝·▐▐·▝`,
	{
		defaultKey: 'm',
		colors: `
············
············
···g····g···
············
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

// ★ = current recommendation for that slot. Ordered line-art → early block →
// refined block, so the progression reads top to bottom.
export const GALLERY: GalleryEntry[] = [
	// ---- Player ----
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
		label: 'eye-hole (block 7×5)',
		note: 'first block pass — eyes as holes',
		sprite: playerEyehole,
	},
	{
		category: 'Player',
		label: 'round-burst (block 7×5)',
		note: 'P1 — faceless rounded blob',
		sprite: playerRoundBurst,
	},
	{
		category: 'Player',
		label: 'burst-holes (block 7×5)',
		note: 'P2 — hole eyes (read as stripes)',
		sprite: playerBurstHoles,
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
	// ---- Chaser ----
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
		label: 'corrupted (block 7×5)',
		note: 'first block pass',
		sprite: chaserCorrupted,
	},
	{
		category: 'Chaser',
		label: 'spiked-burst (block 7×5)',
		note: 'C1 — angular, slit eyes',
		sprite: chaserSpiked,
	},
	{
		category: 'Chaser',
		label: 'gnasher (block 7×5)',
		note: 'C2 — wide gnashing jaw',
		sprite: chaserGnasher,
	},
	{
		category: 'Chaser',
		label: 'glitch (block 7×5)',
		note: 'small spiked burst',
		sprite: chaserGlitch,
	},
	{
		category: 'Chaser',
		label: 'maw (block 7×5)',
		note: 'gnashing-teeth variant',
		sprite: chaserMaw,
	},
	{
		category: 'Chaser',
		label: 'biter (block 12×7)',
		note: 'armoured spiky bug',
		sprite: chaserBiter,
	},
	{
		category: 'Chaser',
		label: 'glitch-beast (block 12×7)',
		note: 'spiky orb, scattered limbs',
		sprite: chaserGlitchBeast,
	},
	{
		category: 'Chaser',
		label: 'glitch-shard (block 12×7)',
		note: 'cracked / split crystal',
		sprite: chaserGlitchShard,
	},
	{
		category: 'Chaser',
		label: 'crawler (block 12×7) ★',
		note: 'domed shell + skittering legs',
		sprite: chaserCrawler,
	},
	// ---- Shooter ----
	{
		category: 'Shooter',
		label: 'eye sentinel (block 10×7) ★',
		note: 'floating one-eyed caster',
		sprite: shooterSentinel,
	},
];
