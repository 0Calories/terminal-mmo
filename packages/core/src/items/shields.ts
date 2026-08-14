export interface Shield {
	name: string;
	sprite: string;
}

export const SHIELDS: readonly Shield[] = [
	{
		name: 'Wooden Shield',
		sprite: 'wooden-shield',
	},
];

export const STARTER_SHIELD = 0;

export function shieldById(i: number | undefined): Shield | undefined {
	if (i === undefined || i < 0 || i >= SHIELDS.length) return undefined;
	return SHIELDS[i];
}
