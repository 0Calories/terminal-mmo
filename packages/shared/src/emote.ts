// The fixed set of emotes a Player can trigger to express themselves in a crowd
// (#38, story 32). An emote is Zone-local like chat (#34) — the server relays it
// to the sender's Channel via sessionsInChannel — and renders the SAME way a chat
// Speech bubble does (#59, ADR 0007): an over-head box on the telegraph layer (ADR
// 0003) that self-clears after a short duration. Where a bubble's content is the
// wrapped chat text, an emote's content is a sized-up multi-row ASCII-art image.
// The set lives in @mmo/shared so the client (input + render) and the server (relay
// validation) agree on exactly which ids exist and what each shows.

export interface EmoteDef {
	id: string; // the slash-command name a Player types: `/em <id>`
	art: readonly string[]; // multi-row ASCII image shown in the over-head box
}

// Small, fixed, and intentional — adding one is a deliberate edit (mirrors the
// curated Warrior skill set). Art is pure ASCII (portable + monochrome) so it
// renders identically in any terminal, a few rows tall so it reads as a sized-up
// image rather than a single glyph.
export const EMOTES: readonly EmoteDef[] = [
	{ id: 'wave', art: [' o/', '/|', '/ \\'] },
	{ id: 'laugh', art: ['^   ^', ' \\_/ '] },
	{ id: 'cry', art: [';   ;', '  o  '] },
	{ id: 'love', art: ['() ()', ' \\ / ', '  v  '] },
	{ id: 'dance', art: ['\\o/', ' |', '/ \\'] },
	{ id: 'angry', art: ['>   <', ' ^^^ '] },
] as const;

// Seconds an emote stays over its Avatar before self-clearing. Long enough to be
// seen by a passer-by, short enough to feel like a reaction, not a status.
export const EMOTE_TTL = 2.5;

// Resolve an emote id to its definition, or undefined for an unknown id. Used by
// the client to validate the typed name (and resolve its art) and by the server
// to drop a bogus emote rather than relay it.
export function emoteById(id: string): EmoteDef | undefined {
	return EMOTES.find((e) => e.id === id);
}
