// Pure trigger detectors that turn an Avatar's per-frame state transition into a
// SoundEffect cue (ADR 0014). These are client-local "self" sounds — played at
// the interaction site the client already observes, never minted onto the wire.
// Kept pure so the trigger mapping is unit-testable headlessly even though the
// audio output itself isn't.

import type { Entity } from '@mmo/shared';

// True on the single frame a jump begins: the Avatar was on the ground and is
// now airborne with upward velocity (negative vy, since y grows downward). The
// upward check distinguishes a real jump from walking off a ledge, which leaves
// the ground with zero/downward velocity and should make no sound.
export function jumpStarted(
	prev: Pick<Entity, 'onGround'>,
	next: Pick<Entity, 'onGround' | 'vy'>,
): boolean {
	return prev.onGround && !next.onGround && next.vy < 0;
}

// True on the single frame an Avatar touches down: it was airborne and is now
// grounded — the opposite edge to `jumpStarted`. Velocity is irrelevant; any
// landing (after a jump, a fall, or walking off a ledge) makes the footfall.
export function landed(
	prev: Pick<Entity, 'onGround'>,
	next: Pick<Entity, 'onGround'>,
): boolean {
	return !prev.onGround && next.onGround;
}

// True when the Player's level rose between two snapshots — the level-up flourish
// fires once on this rising edge, never every frame at the new level. A multi-level
// jump is still one edge (one flourish); a level that drops is silent (defensive
// against respawn/reconnect snapshot ordering).
export function leveledUp(prevLevel: number, nextLevel: number): boolean {
	return nextLevel > prevLevel;
}

// The menu keys that earn a UI blip: directional navigation and confirm. Other
// keys (close/escape, interact, quit, typing) are silent — the blip marks
// movement through a menu, not every keystroke. Shared by every menu so the click
// is consistent across shop / customize.
const MENU_BLIP_KEYS = new Set(['up', 'down', 'left', 'right', 'return']);

export function isMenuBlipKey(name: string): boolean {
	return MENU_BLIP_KEYS.has(name);
}
