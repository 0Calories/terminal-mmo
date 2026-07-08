// Pure trigger detectors turning an Avatar's per-frame state transition into a sound cue
// (ADR 0014). Client-local "self" sounds, played at the site the client observes and
// never minted onto the wire.

import type { Entity } from '@mmo/shared';

// Rising edge of a jump. The upward-velocity check (negative vy, since y grows down)
// distinguishes a real jump from walking off a ledge, which should make no sound.
export function jumpStarted(
	prev: Pick<Entity, 'onGround'>,
	next: Pick<Entity, 'onGround' | 'vy'>,
): boolean {
	return prev.onGround && !next.onGround && next.vy < 0;
}

// Falling edge — the Avatar touches down. Velocity is irrelevant; any landing (jump,
// fall, or walking off a ledge) makes the footfall.
export function landed(
	prev: Pick<Entity, 'onGround'>,
	next: Pick<Entity, 'onGround'>,
): boolean {
	return !prev.onGround && next.onGround;
}

// Rising edge of the Player's level — the flourish fires once, not every frame. A drop
// is silent, defensive against respawn/reconnect snapshot ordering.
export function leveledUp(prevLevel: number, nextLevel: number): boolean {
	return nextLevel > prevLevel;
}

// Menu keys that earn a UI blip: navigation + confirm. Other keys are silent — the blip
// marks movement through a menu, not every keystroke. Shared across shop / customize.
const MENU_BLIP_KEYS = new Set(['up', 'down', 'left', 'right', 'return']);

export function isMenuBlipKey(name: string): boolean {
	return MENU_BLIP_KEYS.has(name);
}
