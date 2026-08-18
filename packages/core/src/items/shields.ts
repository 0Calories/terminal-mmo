import type { Item } from '../entities/types';

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

export function shieldIdByName(name: string): number | undefined {
	const i = SHIELDS.findIndex((s) => s.name === name);
	return i >= 0 ? i : undefined;
}

export function starterShieldItem(id: number): Item {
	return {
		id,
		base: SHIELDS[STARTER_SHIELD].name,
		slot: 'offhand',
		rarity: 'common',
		affixes: [],
	};
}
