import type { Sprite } from './sprite';

// The recolor key the Weapon accent drives (see Weapon accent in CONTEXT.md).
export const WEAPON_ACCENT_KEY = 'a';

// The *art* half of a Weapon (ADR 0036): its Default (rest) frame plus the
// 3-frame `swing` the replicated attack phase indexes (windup → 0, active → 1,
// recovery → 2). Weapon *stats* (name, damage) and the phase → frame selection
// (`swingFrameIndex`) live in @mmo/core.
export interface WeaponSprite {
	frames: {
		rest: Sprite;
		swing: readonly [Sprite, Sprite, Sprite];
	};
	grip: { x: number; y: number };
	accent: string;
}
