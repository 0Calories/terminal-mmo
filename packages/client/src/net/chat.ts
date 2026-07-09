import type { ClientMessage } from '@mmo/core';
import { parseChatCommand } from '../input/chat';

export interface ChatSink {
	send(msg: ClientMessage): void;
	notice(text: string): void;
}

/**
 * Wire a submitted chat line. Returns the emote id when the line fired one, so the
 * caller can predict it locally rather than wait for the snapshot to echo it back.
 */
export function sendChatLine(net: ChatSink, text: string): string | null {
	const line = text.trim();
	if (!line) return null;
	const cmd = parseChatCommand(line);
	switch (cmd.kind) {
		case 'say':
			net.send({ t: 'chat', text: cmd.text });
			return null;
		case 'whisper':
			net.send({ t: 'whisper', to: cmd.to, text: cmd.text });
			return null;
		case 'emote':
			net.send({ t: 'emote', emote: cmd.emote });
			return cmd.emote;
		case 'error':
			net.notice(cmd.message);
			return null;
	}
}
