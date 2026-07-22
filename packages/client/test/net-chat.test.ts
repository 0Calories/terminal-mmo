import { expect, test } from 'bun:test';
import type { ClientMessage } from '@mmo/core/protocol';
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

test('a blank line sends nothing', () => {
	const net = sink();
	expect(sendChatLine(net, '   ')).toBeNull();
	expect(net.sent).toEqual([]);
	expect(net.notices).toEqual([]);
});

test('a malformed command is explained locally and never reaches the wire', () => {
	const net = sink();
	expect(sendChatLine(net, '/w')).toBeNull();
	expect(net.sent).toEqual([]);
	expect(net.notices).toHaveLength(1);
});
