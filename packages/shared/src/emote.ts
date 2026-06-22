// The fixed set of emotes a Player can trigger to express themselves in a crowd
// (#38, story 32). An emote is Zone-local like chat (#34) — the server relays it
// to the sender's Channel via sessionsInChannel — but unlike a Speech bubble it
// renders as a single high-contrast over-head glyph on the telegraph layer (ADR
// 0003) that self-clears after a short duration. The set lives in @mmo/shared so
// the client (input + render) and the server (relay validation) agree on exactly
// which ids exist and what each shows.

export interface EmoteDef {
	id: string; // the slash-command name a Player types: `/em <id>`
	glyph: string; // the over-head symbol rendered above the emoting Avatar
}

// Small, fixed, and intentional — adding one is a deliberate edit (mirrors the
// curated Warrior skill set). Glyphs are single high-contrast symbols so they
// read clearly above a Sprite in any terminal.
export const EMOTES: readonly EmoteDef[] = [
	{ id: 'wave', glyph: '👋' },
	{ id: 'laugh', glyph: '😂' },
	{ id: 'cry', glyph: '😢' },
	{ id: 'love', glyph: '❤' },
	{ id: 'dance', glyph: '🕺' },
	{ id: 'angry', glyph: '😠' },
] as const;

// Seconds an emote stays over its Avatar before self-clearing. Long enough to be
// seen by a passer-by, short enough to feel like a reaction, not a status.
export const EMOTE_TTL = 2.5;

// Resolve an emote id to its definition, or undefined for an unknown id. Used by
// the client to validate the typed name (and render the glyph) and by the server
// to drop a bogus emote rather than relay it.
export function emoteById(id: string): EmoteDef | undefined {
	return EMOTES.find((e) => e.id === id);
}
