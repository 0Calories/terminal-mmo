// The fixed set of emotes a Player can trigger to express themselves in a crowd
// (#38, story 32). An emote is Zone-local like chat (#34) — the server relays it
// to the sender's Channel via sessionsInChannel — and renders the SAME way a chat
// Speech bubble does (#59, ADR 0007): an over-head box on the telegraph layer (ADR
// 0003) that self-clears after a short duration. Where a bubble's content is the
// wrapped chat text, an emote's content is a sized-up, glyph-style pixel-art image
// authored exactly like the in-game Sprites (block-element glyph grid + a colour-
// key grid resolved through the renderer's palette — the chaser paints its eyes
// the same way). The set lives in @mmo/shared so the client (input + render) and
// the server (relay validation) agree on which ids exist and what each shows.

import { Sprite } from './sprites/sprite';

export interface EmoteDef {
	id: string; // the slash-command name a Player types: `/em <id>`
	sprite: Sprite; // the pixel-art image shown in the over-head box
}

// A round face shared by the expression emotes (laugh/cry/angry): the eyes and
// mouth are painted in via the colour grid, the same trick the chaser uses for its
// eyes — so one head glyph yields several distinct faces.
const FACE = `
·▟▀▀▀▙·
▐█████▌
▐█████▌
·▜▄▄▄▛·`;

// Small, fixed, and intentional — adding one is a deliberate edit (mirrors the
// curated Warrior skill set). Only emotes that read clearly as chunky pixel art
// are kept; gesture/figure emotes that don't translate are deliberately omitted.
export const EMOTES: readonly EmoteDef[] = [
	{
		id: 'love',
		sprite: new Sprite(
			`
▄██▄██▄
▀█████▀
··▀█▀··`,
			{ defaultKey: 'm' }, // a solid red heart
		),
	},
	{
		id: 'laugh',
		sprite: new Sprite(FACE, {
			defaultKey: 'y', // yellow face: scrunched squinting eyes + a wide open grin
			colors: `
·yyyyy·
ykkykky
ykkkkky
·yyyyy·`,
		}),
	},
	{
		id: 'cry',
		sprite: new Sprite(FACE, {
			defaultKey: 'y', // yellow face, dark eyes, cyan tears streaming down both cheeks
			colors: `
·yyyyy·
yckykcy
ycykycy
·cyyyc·`,
		}),
	},
	{
		id: 'angry',
		sprite: new Sprite(FACE, {
			defaultKey: 'm', // red face: heavy lowered brows, glaring eyes, a tight scowl
			colors: `
mkkmkkm
mmkmkmm
mmkkkmm
·mmmmm·`,
		}),
	},
] as const;

// Seconds an emote stays over its Avatar before self-clearing. Long enough to be
// seen by a passer-by, short enough to feel like a reaction, not a status.
export const EMOTE_TTL = 2.5;

// Resolve an emote id to its definition, or undefined for an unknown id. Used by
// the client to validate the typed name (and resolve its sprite) and by the server
// to drop a bogus emote rather than relay it.
export function emoteById(id: string): EmoteDef | undefined {
	return EMOTES.find((e) => e.id === id);
}
