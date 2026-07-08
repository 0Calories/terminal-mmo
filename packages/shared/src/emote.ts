// The fixed emote catalog — id, lifetime mode, timing (#38, ADR 0020 §8/§9). An Emote is a
// Pose the Avatar's own body performs, authored on each Form's BodySprite as an
// `emote:<id>` frame set; the art lives with the Form (sprites/forms/*).

// Three lifetime modes: `oneshot` plays once for `duration` seconds then returns to idle;
// `loop` cycles its Pose frames until interrupted; `hold` sustains one Pose until
// interrupted. `stepEmote` reads this tag to decide the cancel, `bodyFrame` the frame
// sweep (ADR 0020 §8).
export type EmoteLifetime = 'oneshot' | 'loop' | 'hold';

export interface EmoteDef {
	id: string; // the slash-command name a Player types: `/em <id>`
	lifetime: EmoteLifetime;
	// Seconds a `oneshot` plays before returning to idle. Ignored by `loop`/`hold`, which
	// persist until the Avatar acts (and so carry duration 0).
	duration: number;
}

// The launch set: `wave` (oneshot), `dance` (loop), `sit` (hold) — one per lifetime mode
// (ADR 0020 §8).
export const EMOTES: readonly EmoteDef[] = [
	{ id: 'wave', lifetime: 'oneshot', duration: 1.6 },
	{ id: 'dance', lifetime: 'loop', duration: 0 },
	{ id: 'sit', lifetime: 'hold', duration: 0 },
] as const;

// The starting `emoteT`: a `oneshot` seeds its full lifetime and counts DOWN to zero; a
// `loop`/`hold` seeds 0 and counts UP as elapsed sim-time. Centralised so server authority
// and owner prediction arm the identical value (ADR 0020 §8/§9).
export function initialEmoteT(def: EmoteDef): number {
	return def.lifetime === 'oneshot' ? def.duration : 0;
}

// Resolve an emote id to its definition, or undefined for an unknown id.
export function emoteById(id: string): EmoteDef | undefined {
	return EMOTES.find((e) => e.id === id);
}

// Whether the entity is acting in a way that cancels an active emote: the instant it
// moves, swings, guards, dodges, or is Staggered, the emote clears (and does not resume
// when it stops) (ADR 0020 §6/§9).
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

// Advance an active emote by `dt`. Cleared the instant `acting` (never resumes after a
// cancel); otherwise a `oneshot` counts DOWN and clears when it elapses, a `loop`/`hold`
// counts its elapsed sim-time UP. The caller passes `acting` from `emoteInterrupted`
// (ADR 0020 §6/§9).
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
