import type { Sprite } from './sprite';

// The art colour key whose cells are the weapon's dynamic ACCENT (ADR 0018 §6): the
// renderer repaints these to the resolved `accent` colour every frame, so the blade
// and the blade-edge arc read in one weapon colour — and the whole blade re-tints
// when a rarity tier later feeds the accent channel. Structural cells (guard, grip)
// keep their authored keys, so only the one dynamic channel moves.
export const WEAPON_ACCENT_KEY = 'a';

// The frames a WeaponSprite may pose through (ADR 0018 §4). `idle`, `windup` and
// `recovery` are single hold poses chosen by phase; `active` is an ORDERED SWEEP of
// frames sampled by `swingProgress` (first frame at progress 0, last at 1). The
// selector returns a frame id every frame; an unauthored frame draws no weapon layer.
export type WeaponFrameId = 'idle' | 'windup' | 'active' | 'recovery';

// A WeaponSprite is a dedicated ANIMATED sprite type (ADR 0018 §2), distinct from
// the single-frame `Sprite` the player, monsters and hats use — only weapons animate
// today, so a focused type carries the new shape rather than generalizing `Sprite`.
// It is a named frame set (each frame an authored glyph+colour grid like any Sprite),
// plus a grip anchor (§3) and a single dynamic accent colour (§6).
export interface WeaponSprite {
	// The named frame set. `idle`/`windup`/`recovery` are single hold poses; `active`
	// is an ordered sweep the renderer indexes by `swingProgress` (ADR 0018 §4 — first
	// frame at 0, last at 1). Every member is optional, so the selection seam falls
	// back gracefully (an unauthored phase simply draws no weapon layer).
	frames: {
		idle?: Sprite;
		windup?: Sprite;
		active?: readonly Sprite[];
		recovery?: Sprite;
	};
	// The cell within the weapon art (right-facing coords) aligned to the BODY's
	// grip cell, grip-to-grip (ADR 0018 §3). Mirrored alongside the art on facing.
	grip: { x: number; y: number };
	// The one dynamic colour channel (ADR 0018 §6): a palette key fed to the blade
	// highlight and blade-edge arc. This is the rarity-ready seam — a rolled tier
	// colour later flows through the same channel.
	accent: string;
}
