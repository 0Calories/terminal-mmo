import { Sprite } from './sprite';

// The cosmetic hat catalog (#35, ADR 0003): a decorative Sprite overlaid above the
// Avatar's head, anchored by the renderer so it never occludes the face. Index 0 is the
// bareheaded default.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
export interface HatDef {
	name: string;
	sprite: Sprite | null;
}

const cap = new Sprite(`▄█████▄`, { defaultKey: 'o' });

const crown = new Sprite(`█▄█▄█`, { defaultKey: 'y' });

const wizard = new Sprite(
	`
··▟█▙··
·▟███▙·
███████`,
	{
		defaultKey: 'c',
		colors: `
··ccc··
·ccccc·
·ooooo·`,
	},
);

const topHat = new Sprite(
	`
·█████·
·█████·
▄█████▄`,
	{
		defaultKey: 'k',
		colors: `
·kkkkk·
·mmmmm·
kkkkkk`,
	},
);

// The demo's one added hat, landing the catalog at ADR 0024 §8's cap.
const partyHat = new Sprite(
	`
··▲··
·▟█▙·
▄███▄`,
	{
		defaultKey: 'c',
		colors: `
··y··
·ccc·
·mmm·`,
	},
);

// Index is the on-the-wire cosmetic hat id; order is stable (append only).
export const HATS: readonly HatDef[] = [
	{ name: 'None', sprite: null },
	{ name: 'Cap', sprite: cap },
	{ name: 'Crown', sprite: crown },
	{ name: 'Wizard', sprite: wizard },
	{ name: 'Top Hat', sprite: topHat },
	{ name: 'Party Hat', sprite: partyHat },
];
