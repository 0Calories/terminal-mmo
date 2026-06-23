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
