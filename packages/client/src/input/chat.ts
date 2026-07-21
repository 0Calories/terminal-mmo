import { EMOTES, type EmoteId } from '@mmo/core/entities';

export type ChatCommand =
	| { kind: 'say'; text: string }
	| { kind: 'whisper'; to: string; text: string }
	| { kind: 'emote'; emote: string }
	| { kind: 'error'; message: string };

type CommandHandler = (rest: string) => ChatCommand;

const WHISPER_USAGE = 'Usage: /w <handle> <message>';
const EMOTE_LIST = `Emotes: ${EMOTES.map((e) => `/${e.id}`).join(', ')}`;

const whisper: CommandHandler = (rest) => {
	const sp = rest.search(/\s/);
	if (sp < 0) return { kind: 'error', message: WHISPER_USAGE };
	const to = rest.slice(0, sp);
	const text = rest.slice(sp + 1).trim();
	if (!to || !text) return { kind: 'error', message: WHISPER_USAGE };
	return { kind: 'whisper', to, text };
};

const emote =
	(id: EmoteId): CommandHandler =>
	() => ({ kind: 'emote', emote: id });

// The one registry of every chat command. Duplicate names are a compile error
// (duplicate object keys), and the EmoteId half of the satisfies check makes
// forgetting to register a newly added emote one too.
const COMMANDS = {
	w: whisper,
	whisper,
	emotes: () => ({ kind: 'error', message: EMOTE_LIST }),
	wave: emote('wave'),
	dance: emote('dance'),
	sit: emote('sit'),
} satisfies Record<string, CommandHandler> & Record<EmoteId, CommandHandler>;

export function parseChatCommand(line: string): ChatCommand {
	const trimmed = line.trim();
	if (!trimmed.startsWith('/')) return { kind: 'say', text: trimmed };
	const sp = trimmed.search(/\s/);
	const name = (sp < 0 ? trimmed : trimmed.slice(0, sp)).slice(1);
	if (!Object.hasOwn(COMMANDS, name))
		return {
			kind: 'error',
			message: `Unknown command: /${name} — try ${EMOTE_LIST}`,
		};
	const rest = sp < 0 ? '' : trimmed.slice(sp + 1).trim();
	return COMMANDS[name as keyof typeof COMMANDS](rest);
}
