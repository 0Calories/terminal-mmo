// The fixed set of emotes a Player can trigger to express themselves (#38, ADR
// 0020 §8/§9). An Emote is no longer an over-head face popup — it is a Pose the
// Avatar's OWN body performs, authored on each Form's BodySprite as an `emote:<id>`
// frame set and selected by the shared `bodyFrame` ladder. This module owns only the
// emote *catalog* — id, lifetime mode, and timing — so the client (input + the local
// prediction) and the server (the authoritative trigger) agree on which ids exist and
// how each behaves. The art itself lives with the Form (sprites/forms/*).

// How long an active emote lives once triggered (ADR 0020 §8). Three modes: a `oneshot`
// plays once for `duration` seconds then the body returns to `idle`; a `loop` cycles its
// Pose frames until interrupted; a `hold` sustains a single Pose until interrupted. The
// seam is this lifetime tag — `stepEmote` reads it to decide the cancel, and `bodyFrame`
// reads it to decide the frame sweep — so adding a mode stays (nearly) pure data.
export type EmoteLifetime = 'oneshot' | 'loop' | 'hold';

export interface EmoteDef {
	id: string; // the slash-command name a Player types: `/em <id>`
	lifetime: EmoteLifetime;
	// Seconds a `oneshot` plays before the body returns to idle — chosen so a passer-by
	// catches the wave but it reads as a reaction, not a held status. Ignored by `loop`/
	// `hold`, which persist until the Avatar acts (and so carry duration 0).
	duration: number;
}

// Small, fixed, and intentional — adding one is a deliberate edit (mirrors the curated
// Warrior skill set). The launch set: the `oneshot` `wave`, the `loop` `dance`, and the
// `hold` `sit` — one emote per lifetime mode (ADR 0020 §8).
export const EMOTES: readonly EmoteDef[] = [
	{ id: 'wave', lifetime: 'oneshot', duration: 1.6 },
	{ id: 'dance', lifetime: 'loop', duration: 0 },
	{ id: 'sit', lifetime: 'hold', duration: 0 },
] as const;

// The starting `emoteT` for a freshly triggered emote (ADR 0020 §8/§9). A `oneshot` seeds
// its full lifetime and counts DOWN to zero; a `loop`/`hold` seeds 0 and counts UP, so its
// `emoteT` is the elapsed sim-time since the emote began (the deterministic clock the loop
// frame advance samples). Centralised so the server's authority and the owner's prediction
// arm the identical value.
export function initialEmoteT(def: EmoteDef): number {
	return def.lifetime === 'oneshot' ? def.duration : 0;
}

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
// (moving / combat / stagger, ADR 0020 §6/§9) — an emote never resumes after a cancel.
// Otherwise the lifetime mode decides: a `oneshot` counts its remaining time DOWN and
// clears when it elapses; a `loop`/`hold` persists and counts its elapsed sim-time UP (so
// the loop frame advance is a deterministic function of it, the same rule as the walk
// cycle — every observer samples the identical frame). Pure, so the owner's prediction and
// the server's authority agree frame-for-frame. The caller passes `acting` from
// `emoteInterrupted` on the entity's resolved state.
export function stepEmote(
	emoteId: string | null | undefined,
	emoteT: number,
	acting: boolean,
	dt: number,
): { emoteId: string | null; emoteT: number } {
	if (!emoteId || acting) return { emoteId: null, emoteT: 0 };
	const def = emoteById(emoteId);
	if (!def) return { emoteId: null, emoteT: 0 }; // unknown id → drop, never pose a phantom
	if (def.lifetime === 'oneshot') {
		const t = emoteT - dt;
		if (t <= 0) return { emoteId: null, emoteT: 0 }; // oneshot elapsed → back to idle
		return { emoteId, emoteT: t };
	}
	// loop / hold: persist until interrupted; accumulate elapsed sim-time since the start.
	return { emoteId, emoteT: emoteT + dt };
}
