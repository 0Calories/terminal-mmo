// Chat command parsing (#34, retained-UI side of ADR 0005). The editing/typing surface
// is now an OpenTUI InputRenderable (see message-log.ts, #272); this module keeps only
// the pure classification of a *submitted* line, unit-tested without a renderer or socket.

import { EMOTES, emoteById } from '@mmo/shared';

// A sent chat line resolved to its intent: a Zone-local say, a directed whisper
// (#40), a triggered emote (#38), or a usage error to surface locally (no
// round-trip). Pure so the slash parsing is unit-tested without a renderer or socket.
export type ChatCommand =
	| { kind: 'say'; text: string }
	| { kind: 'whisper'; to: string; text: string }
	| { kind: 'emote'; emote: string }
	| { kind: 'error'; message: string };

const WHISPER_USAGE = 'Usage: /w <handle> <message>';
// Doubles as the listing for `/emotes` and the hint for a bad `/em`: it names the whole
// available set (ADR 0020 §9), so a Player discovers the emotes either way.
const EMOTE_USAGE = `Emotes: ${EMOTES.map((e) => e.id).join(', ')} — use /em <name>`;

// Classify a sent line: `/w <handle> <message>` (or `/whisper …`) is a whisper;
// `/em <name>` (or `/emote …`) triggers a body emote from the fixed set; `/emotes`
// lists that set; anything else is a Zone-local say. A whisper missing a handle/message,
// or an emote with an unknown / missing name, is an error the caller shows in the log
// instead of sending. `/emotes` likewise surfaces the listing locally (no round-trip).
export function parseChatCommand(line: string): ChatCommand {
	const trimmed = line.trim();
	// `/emotes` lists the set. Checked before the `/em` trigger (whose `\b` won't match
	// the trailing `s`), so listing and triggering stay distinct commands.
	if (/^\/emotes\b/.test(trimmed))
		return { kind: 'error', message: EMOTE_USAGE };
	const em = /^\/(?:em|emote)\b\s*(.*)$/s.exec(trimmed);
	if (em) {
		const name = em[1].trim().split(/\s+/)[0] ?? '';
		if (!name || !emoteById(name))
			return { kind: 'error', message: EMOTE_USAGE };
		return { kind: 'emote', emote: name };
	}
	const m = /^\/(?:w|whisper)\b\s*(.*)$/s.exec(trimmed);
	if (!m) return { kind: 'say', text: trimmed };
	const rest = m[1].trimStart();
	const sp = rest.search(/\s/);
	if (sp < 0) return { kind: 'error', message: WHISPER_USAGE };
	const to = rest.slice(0, sp);
	const text = rest.slice(sp + 1).trim();
	if (!to || !text) return { kind: 'error', message: WHISPER_USAGE };
	return { kind: 'whisper', to, text };
}
