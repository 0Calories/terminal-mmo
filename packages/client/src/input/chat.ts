import { EMOTES, emoteById } from '@mmo/core';

export type ChatCommand =
	| { kind: 'say'; text: string }
	| { kind: 'whisper'; to: string; text: string }
	| { kind: 'emote'; emote: string }
	| { kind: 'error'; message: string };

const WHISPER_USAGE = 'Usage: /w <handle> <message>';
const EMOTE_USAGE = `Emotes: ${EMOTES.map((e) => e.id).join(', ')} — use /em <name>`;

export function parseChatCommand(line: string): ChatCommand {
	const trimmed = line.trim();
	// Must precede /em, whose \b won't match the trailing 's'.
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
