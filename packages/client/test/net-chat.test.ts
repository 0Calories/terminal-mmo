import { expect, test } from 'bun:test';
import type { ClientMessage } from '@mmo/shared';
import { EMOTES } from '@mmo/shared';
import { sendChatLine } from '../src/net/chat';

function sink() {
	const sent: ClientMessage[] = [];
	const notices: string[] = [];
	return {
		sent,
		notices,
		send: (msg: ClientMessage) => sent.push(msg),
		notice: (text: string) => notices.push(text),
	};
}

test('a plain line goes out as chat', () => {
	const net = sink();
	expect(sendChatLine(net, '  hello there  ')).toBeNull();
	expect(net.sent).toEqual([{ t: 'chat', text: 'hello there' }]);
});

test('a blank line sends nothing', () => {
	const net = sink();
	expect(sendChatLine(net, '   ')).toBeNull();
	expect(net.sent).toEqual([]);
	expect(net.notices).toEqual([]);
});

test('a whisper goes out addressed to its target', () => {
	const net = sink();
	expect(sendChatLine(net, '/w trin behind you')).toBeNull();
	expect(net.sent).toEqual([{ t: 'whisper', to: 'trin', text: 'behind you' }]);
});

test('an emote goes out and is handed back for local prediction', () => {
	const net = sink();
	const id = EMOTES[0].id;
	expect(sendChatLine(net, `/em ${id}`)).toBe(id);
	expect(net.sent).toEqual([{ t: 'emote', emote: id }]);
});

test('a malformed command is explained locally and never reaches the wire', () => {
	const net = sink();
	expect(sendChatLine(net, '/w')).toBeNull();
	expect(net.sent).toEqual([]);
	expect(net.notices).toHaveLength(1);
});
