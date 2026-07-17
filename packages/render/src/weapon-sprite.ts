import type { Sprite } from './sprite';

// The recolor key the Weapon accent drives (see Weapon accent in CONTEXT.md).
export const WEAPON_ACCENT_KEY = 'a';

// The *art* half of a Weapon: its animated frame set. Weapon *stats* (name, damage)
// and animation selection (WeaponFrameId) live in @mmo/core.
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
