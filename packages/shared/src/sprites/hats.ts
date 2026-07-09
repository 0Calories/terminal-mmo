import { Sprite } from './sprite';

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

export const HATS: readonly HatDef[] = [
	{ name: 'None', sprite: null },
	{ name: 'Cap', sprite: cap },
	{ name: 'Crown', sprite: crown },
	{ name: 'Wizard', sprite: wizard },
	{ name: 'Top Hat', sprite: topHat },
	{ name: 'Party Hat', sprite: partyHat },
];
