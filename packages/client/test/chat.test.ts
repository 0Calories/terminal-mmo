import { expect, test } from 'bun:test';
import { ChatInput } from '../src/chat';

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
