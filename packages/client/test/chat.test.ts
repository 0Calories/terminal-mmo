import { expect, test } from 'bun:test';
import { CHAT_MAX_LEN } from '@mmo/shared';
import { ChatInput, parseChatCommand } from '../src/chat';

// Drive a sequence of printable characters into an open ChatInput.
function type(chat: ChatInput, s: string) {
	for (const ch of s) chat.key({ name: ch, sequence: ch });
}

test('opening, typing, and Enter yields a send with the typed text', () => {
	const chat = new ChatInput();
	chat.start();
	type(chat, 'hi');
	const res = chat.key({ name: 'return' });
	expect(res).toEqual({ action: 'send', text: 'hi' });
});

test('backspace deletes the last char and space inserts a blank', () => {
	const chat = new ChatInput();
	chat.start();
	type(chat, 'hey');
	chat.key({ name: 'backspace' });
	chat.key({ name: 'space', sequence: ' ' });
	type(chat, 'yo');
	expect(chat.text).toBe('he yo');
});

test('Escape cancels typing mode without sending and clears the draft', () => {
	const chat = new ChatInput();
	chat.start();
	type(chat, 'oops');
	const res = chat.key({ name: 'escape' });
	expect(res).toEqual({ action: 'cancel' });
	expect(chat.open).toBe(false);
	expect(chat.text).toBe('');
});

test('while open, movement/combat keys are consumed (never leak to play input)', () => {
	const chat = new ChatInput();
	chat.start();
	// 'a'/'d' = move, 'j' = attack, space = jump — all must be consumed as text,
	// so the caller (which forwards only `none`) can never feed them to the sim.
	for (const k of ['a', 'd', 'j']) {
		const res = chat.key({ name: k, sequence: k });
		expect(res.action).not.toBe('none');
	}
	expect(chat.key({ name: 'space', sequence: ' ' }).action).not.toBe('none');
	expect(chat.text).toBe('adj '); // they typed into the line instead of moving
});

test('while closed, keys pass through as none so play input handles them', () => {
	const chat = new ChatInput();
	expect(chat.key({ name: 'd', sequence: 'd' })).toEqual({ action: 'none' });
	expect(chat.text).toBe('');
});

test('typing cannot exceed the shared chat cap (#59, ADR 0007)', () => {
	const chat = new ChatInput();
	chat.start();
	type(chat, 'a'.repeat(CHAT_MAX_LEN + 50));
	expect(chat.text.length).toBe(CHAT_MAX_LEN);
});

test('parseChatCommand treats a plain line as a Zone-local say', () => {
	expect(parseChatCommand('hello field')).toEqual({
		kind: 'say',
		text: 'hello field',
	});
});

test('parseChatCommand parses /w <handle> <message> into a whisper (#40)', () => {
	expect(parseChatCommand('/w Trinity follow the rabbit')).toEqual({
		kind: 'whisper',
		to: 'Trinity',
		text: 'follow the rabbit',
	});
	// The long form and surrounding whitespace work too.
	expect(parseChatCommand('  /whisper  neo   hey there  ')).toEqual({
		kind: 'whisper',
		to: 'neo',
		text: 'hey there',
	});
});

test('parseChatCommand reports a usage error when the whisper has no message', () => {
	expect(parseChatCommand('/w neo').kind).toBe('error');
	expect(parseChatCommand('/w').kind).toBe('error');
});

test('parseChatCommand parses /em <name> into a body-emote trigger (ADR 0020 §9)', () => {
	expect(parseChatCommand('/em wave')).toEqual({
		kind: 'emote',
		emote: 'wave',
	});
	// The long form and surrounding whitespace work too.
	expect(parseChatCommand('  /emote   wave  ')).toEqual({
		kind: 'emote',
		emote: 'wave',
	});
});

test('parseChatCommand rejects an unknown or missing emote name with the usage hint (#38)', () => {
	const bad = parseChatCommand('/em bogus');
	expect(bad.kind).toBe('error');
	// The hint names the available set, so a typo teaches the right name.
	if (bad.kind === 'error') expect(bad.message).toContain('wave');
	expect(parseChatCommand('/em').kind).toBe('error');
});

test('parseChatCommand lists the available emotes for /emotes (ADR 0020 §9)', () => {
	const cmd = parseChatCommand('/emotes');
	expect(cmd.kind).toBe('error'); // a local listing, surfaced as a notice (no round-trip)
	if (cmd.kind === 'error') expect(cmd.message).toContain('wave');
	// `/emotes` is its own command — NOT a malformed `/em` trigger.
	expect(cmd.kind).not.toBe('emote');
});
