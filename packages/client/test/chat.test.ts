import { expect, test } from 'bun:test';
import { parseChatCommand } from '../src/chat';

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

test('parseChatCommand parses /em <name> into a body-emote trigger (ADR 0020 §9)', () => {
	expect(parseChatCommand('/em wave')).toEqual({
		kind: 'emote',
		emote: 'wave',
	});
	expect(parseChatCommand('  /emote   wave  ')).toEqual({
		kind: 'emote',
		emote: 'wave',
	});
});

test('parseChatCommand rejects an unknown or missing emote name with the usage hint (#38)', () => {
	const bad = parseChatCommand('/em bogus');
	expect(bad.kind).toBe('error');
	if (bad.kind === 'error') expect(bad.message).toContain('wave');
	expect(parseChatCommand('/em').kind).toBe('error');
});

test('parseChatCommand lists the available emotes for /emotes (ADR 0020 §9)', () => {
	const cmd = parseChatCommand('/emotes');
	expect(cmd.kind).toBe('error'); // a local listing surfaced as a notice, not a wire round-trip
	if (cmd.kind === 'error') expect(cmd.message).toContain('wave');
	expect(cmd.kind).not.toBe('emote');
});
