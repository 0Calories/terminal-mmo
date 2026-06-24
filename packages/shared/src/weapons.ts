import { COMBAT } from './constants';
import { sword, type WeaponSprite } from './sprites';
import type { SwingPhases } from './types';

// The trail look a weapon may leave during its active sweep (ADR 0017 §14): a
// string key the CLIENT resolves to a ParticleType, the same shared-owns-the-fact /
// client-owns-the-pixels seam as EffectKind. Absent == no trail. Append-only, like
// the Effect catalog, so a forward-version key can't crash an older client.
export type WeaponTrail = 'heavy' | 'light';

// A Weapon stat block (ADR 0017 §14): the data an equipped Weapon Item feeds into
// BOTH the combat model and the visuals, so weapons differ mechanically AND on
// screen without any per-weapon special-casing. Indexed in WEAPONS; the index is
// the wire-replicated appearance id, so a weapon is fully described by one small
// int. All weapons share the one Warrior moveset — they differ only in these
// numbers, the glyph, and the trail (weapon-specific movesets are out of scope).
export interface Weapon {
	name: string;
	// Single-glyph weapon-tip accent composited onto the per-phase pose (ADR 0017
	// §13a). Oriented by facing at render time. A glyph, not a full sprite, matching
	// the existing minimal pose-accent system.
	glyph: string;
	// --- Stat block: combat params plugged into resolveCombat / the hit-reaction ---
	damage: number; // HP per landed hit
	reach: number; // melee hitbox width (the swing's arc size)
	poiseDamage: number; // Poise chipped per hit
	knockback: number; // horizontal Knockback impulse on a Poise break
	knockbackUp: number; // upward pop on a break
	swing: SwingPhases; // wind-up → active → recovery phase durations (phase-speed)
	// Optional trail ParticleType key the client renders during the active sweep.
	trail?: WeaponTrail;
	// The always-anchored animated appearance (ADR 0018): a WeaponSprite composited
	// onto the Avatar at the grip every frame. Optional while art is authored weapon
	// by weapon — an absent sprite simply draws no weapon layer.
	sprite?: WeaponSprite;
}

// The catalog. Index 0 is the default Warrior sword, deliberately identical to the
// pre-weapon COMBAT defaults so an Avatar with no weapon plays EXACTLY as before.
// The greatsword and dagger sit at the extremes (slow/heavy vs fast/light) so the
// stat block's effect is visible and feelable from data alone (ADR 0017 §14).
export const WEAPONS: readonly Weapon[] = [
	{
		name: 'Sword',
		glyph: '╱',
		damage: COMBAT.meleeDamage,
		reach: COMBAT.meleeReach,
		poiseDamage: COMBAT.poiseDamage,
		knockback: COMBAT.knockback,
		knockbackUp: COMBAT.knockbackUp,
		swing: { ...COMBAT.swing },
		sprite: sword,
	},
	{
		// Slow to commit, but each connect lands hard and staggers almost on its own.
		name: 'Greatsword',
		glyph: '╋',
		damage: 16,
		reach: 9,
		poiseDamage: 16,
		knockback: 72,
		knockbackUp: 22,
		swing: { windup: 0.24, active: 0.16, recovery: 0.3 },
		trail: 'heavy',
	},
	{
		// A blur of fast pokes that barely move a target — pressure, not impact.
		name: 'Dagger',
		glyph: '╿',
		damage: 4,
		reach: 4,
		poiseDamage: 4,
		knockback: 18,
		knockbackUp: 8,
		swing: { windup: 0.05, active: 0.07, recovery: 0.08 },
		trail: 'light',
	},
];

export const DEFAULT_WEAPON = 0;

// Clamp-to-default lookup (mirrors clampCosmetics): an absent, out-of-range, or
// forward-version index can never crash combat or the renderer — it falls back to
// the default sword.
export function weaponById(i: number | undefined): Weapon {
	if (i === undefined || i < 0 || i >= WEAPONS.length)
		return WEAPONS[DEFAULT_WEAPON];
	return WEAPONS[i];
}

// Total committed duration of one swing (wind-up + active + recovery), the
// weapon-aware analogue of SWING_TOTAL — what makes a greatsword's swing read as
// slower than a dagger's end-to-end.
export function weaponSwingTotal(w: Weapon): number {
	return w.swing.windup + w.swing.active + w.swing.recovery;
}
