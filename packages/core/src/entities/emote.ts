export type EmoteLifetime = 'oneshot' | 'loop' | 'hold';

export interface EmoteDef {
	id: string;
	lifetime: EmoteLifetime;
	duration: number;
}

export const EMOTES = [
	{ id: 'wave', lifetime: 'oneshot', duration: 1.6 },
	{ id: 'dance', lifetime: 'loop', duration: 0 },
	{ id: 'sit', lifetime: 'hold', duration: 0 },
] as const satisfies readonly EmoteDef[];

export type EmoteId = (typeof EMOTES)[number]['id'];

export function initialEmoteT(def: EmoteDef): number {
	return def.lifetime === 'oneshot' ? def.duration : 0;
}

export function emoteById(id: string): EmoteDef | undefined {
	return EMOTES.find((e) => e.id === id);
}

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

export function stepEmote(
	emoteId: string | null | undefined,
	emoteT: number,
	acting: boolean,
	dt: number,
): { emoteId: string | null; emoteT: number } {
	if (!emoteId || acting) return { emoteId: null, emoteT: 0 };
	const def = emoteById(emoteId);
	if (!def) return { emoteId: null, emoteT: 0 };
	if (def.lifetime === 'oneshot') {
		const t = emoteT - dt;
		if (t <= 0) return { emoteId: null, emoteT: 0 };
		return { emoteId, emoteT: t };
	}
	return { emoteId, emoteT: emoteT + dt };
}
