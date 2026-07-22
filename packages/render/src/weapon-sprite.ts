import type { Sprite } from './sprite';

export const WEAPON_ACCENT_KEY = 'a';

export interface WeaponSprite {
	frames: {
		rest: Sprite;
		swing: readonly [Sprite, Sprite, Sprite];
	};
	grip: { x: number; y: number };
	accent: string;
}
