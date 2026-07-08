import type { Sprite } from './sprite';

// Cells with this colour key are repainted to the resolved `accent` every frame, so the
// blade reads in one weapon colour and re-tints when rarity feeds the channel (ADR 0018 §6).
export const WEAPON_ACCENT_KEY = 'a';

// `idle`/`windup`/`recovery` are single hold poses; `active` is an ordered sweep sampled
// by `swingProgress` (0 to 1). An unauthored frame draws no weapon layer (ADR 0018 §4).
export type WeaponFrameId = 'idle' | 'windup' | 'active' | 'recovery';

// A dedicated animated sprite type, kept distinct from single-frame `Sprite` because only
// weapons animate today (ADR 0018 §2): a named frame set plus a grip anchor and accent.
export interface WeaponSprite {
	// `active` is an ordered sweep indexed by `swingProgress`; an unauthored phase draws
	// no weapon layer (ADR 0018 §4).
	frames: {
		idle?: Sprite;
		windup?: Sprite;
		active?: readonly Sprite[];
		recovery?: Sprite;
	};
	// Cell (right-facing coords) aligned to the body's grip cell grip-to-grip (ADR 0018 §3).
	grip: { x: number; y: number };
	// The one dynamic colour channel, rarity-ready: a rolled tier colour flows here later (ADR 0018 §6).
	accent: string;
}
