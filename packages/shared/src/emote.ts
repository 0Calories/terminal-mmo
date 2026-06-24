// The fixed set of emotes a Player can trigger to express themselves (#38, ADR
// 0020 §8/§9). An Emote is no longer an over-head face popup — it is a Pose the
// Avatar's OWN body performs, authored on each Form's BodySprite as an `emote:<id>`
// frame set and selected by the shared `bodyFrame` ladder. This module owns only the
// emote *catalog* — id, lifetime mode, and timing — so the client (input + the local
// prediction) and the server (the authoritative trigger) agree on which ids exist and
// how each behaves. The art itself lives with the Form (sprites/forms/*).

// How long an active emote lives once triggered (ADR 0020 §8). This slice ships the
// `oneshot` mode only: the Pose plays once for `duration` seconds, then the body
// returns to `idle`. `loop` (cycles until interrupted) and `hold` (a single sustained
// pose) are deferred — the seam is the lifetime tag, so adding them is pure data.
export type EmoteLifetime = 'oneshot';

export interface EmoteDef {
	id: string; // the slash-command name a Player types: `/em <id>`
	lifetime: EmoteLifetime;
	// Seconds a `oneshot` plays before the body returns to idle. Chosen so a passer-by
	// catches the wave but it reads as a reaction, not a held status.
	duration: number;
}

// Small, fixed, and intentional — adding one is a deliberate edit (mirrors the curated
// Warrior skill set). The launch set is the single `oneshot` `wave`; `dance` (loop) and
// `sit` (hold) join when their lifetime modes land (ADR 0020 §8).
export const EMOTES: readonly EmoteDef[] = [
	{ id: 'wave', lifetime: 'oneshot', duration: 1.6 },
] as const;

// Resolve an emote id to its definition, or undefined for an unknown id. Used by the
// client to validate the typed name and by the server to drop a bogus trigger.
export function emoteById(id: string): EmoteDef | undefined {
	return EMOTES.find((e) => e.id === id);
}

// Whether an entity is currently ACTING in a way that outranks — and so cancels — an
// active emote on the precedence ladder (ADR 0020 §6/§9). An emote is a "standing still
// and posing" moment, so the instant the Avatar moves, swings, guards, dodges, or is
// Staggered, the emote clears (it does not resume when the Avatar stops). Pure, reading
// only the replicated locomotion + combat signals, so owner prediction and the server
// authority compute the identical cancel.
export function emoteInterrupted(e: {
	vx: number;
	attackT: number;
	dodgeT?: number;
	guardT?: number;
	stunT?: number;
}): boolean {
	return (
		e.vx !== 0 ||
		e.attackT > 0 ||
		(e.dodgeT ?? 0) > 0 ||
		(e.guardT ?? 0) > 0 ||
		(e.stunT ?? 0) > 0
	);
}

// Advance an entity's active emote by `dt`. Cleared the instant the Avatar `acting`s
// (moving / combat / stagger, ADR 0020 §6/§9) and when a `oneshot`'s timer elapses;
// otherwise the remaining time counts down. Pure, so the owner's prediction and the
// server's authority agree frame-for-frame on when the body drops back to idle. The
// caller passes `acting` from `emoteInterrupted` on the entity's resolved state.
export function stepEmote(
	emoteId: string | null | undefined,
	emoteT: number,
	acting: boolean,
	dt: number,
): { emoteId: string | null; emoteT: number } {
	if (!emoteId || acting) return { emoteId: null, emoteT: 0 };
	const t = emoteT - dt;
	if (t <= 0) return { emoteId: null, emoteT: 0 }; // oneshot elapsed → back to idle
	return { emoteId, emoteT: t };
}
