import type { Sprite } from './sprite';

// The frames a WeaponSprite may pose through (ADR 0018 §4). Only `idle` (a hold
// pose) is authored in this slice; `windup`/`active`/`recovery` land with the swing
// rework. The selector returns a frame id every frame; an unauthored frame simply
// draws no weapon layer (the legacy swing overlay covers the swing for now).
export type WeaponFrameId = 'idle' | 'windup' | 'active' | 'recovery';

// A WeaponSprite is a dedicated ANIMATED sprite type (ADR 0018 §2), distinct from
// the single-frame `Sprite` the player, monsters and hats use — only weapons animate
// today, so a focused type carries the new shape rather than generalizing `Sprite`.
// It is a named frame set (each frame an authored glyph+colour grid like any Sprite),
// plus a grip anchor (§3) and a single dynamic accent colour (§6).
export interface WeaponSprite {
	// The named frame set. `idle` is the always-visible hold pose; the rest are
	// optional until authored, so the selection seam falls back gracefully.
	frames: Partial<Record<WeaponFrameId, Sprite>>;
	// The cell within the weapon art (right-facing coords) aligned to the BODY's
	// grip cell, grip-to-grip (ADR 0018 §3). Mirrored alongside the art on facing.
	grip: { x: number; y: number };
	// The one dynamic colour channel (ADR 0018 §6): a palette key fed to the blade
	// highlight, blade-edge arc and motion trail in the swing rework. This is the
	// rarity-ready seam — a rolled tier colour later flows through the same channel.
	accent: string;
}
