import type { Sprite } from './sprite';

export const WEAPON_ACCENT_KEY = 'a';

export type WeaponFrameId = 'idle' | 'windup' | 'active' | 'recovery';

export interface WeaponSprite {
	frames: {
		idle?: Sprite;
		windup?: Sprite;
		active?: readonly Sprite[];
		recovery?: Sprite;
	};
	grip: { x: number; y: number };
	accent: string;
}
