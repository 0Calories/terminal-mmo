import { expect, test } from 'bun:test';
import { parseChatCommand } from '../src/input/chat';

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

test('parseChatCommand parses /<name> into a body-emote trigger (ADR 0020 §9)', () => {
	expect(parseChatCommand('/wave')).toEqual({ kind: 'emote', emote: 'wave' });
	expect(parseChatCommand('  /sit  ')).toEqual({ kind: 'emote', emote: 'sit' });
});

test('parseChatCommand ignores trailing text after an emote command', () => {
	expect(parseChatCommand('/wave hello everyone')).toEqual({
		kind: 'emote',
		emote: 'wave',
	});
});

test('parseChatCommand retired /em — it is now an unknown command', () => {
	expect(parseChatCommand('/em wave').kind).toBe('error');
	expect(parseChatCommand('/emote wave').kind).toBe('error');
});

test('parseChatCommand reserves the slash namespace: unknown commands are a local error, never chat', () => {
	const bad = parseChatCommand('/wavee');
	expect(bad.kind).toBe('error');
	if (bad.kind === 'error') expect(bad.message).toContain('/wavee');
	expect(parseChatCommand('/foo bar').kind).toBe('error');
	expect(parseChatCommand('/').kind).toBe('error');
});

test('parseChatCommand lists the available emotes for /emotes (ADR 0020 §9)', () => {
	const cmd = parseChatCommand('/emotes');
	expect(cmd.kind).toBe('error'); // a local listing surfaced as a notice, not a wire round-trip
	if (cmd.kind === 'error') expect(cmd.message).toContain('wave');
	expect(cmd.kind).not.toBe('emote');
});
