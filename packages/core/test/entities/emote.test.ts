import { describe, expect, test } from 'bun:test';
import {
	EMOTES,
	emoteById,
	emoteInterrupted,
	initialEmoteT,
	stepEmote,
} from '../../src/entities';

const emoteWith = (lifetime: 'oneshot' | 'loop' | 'hold') => {
	const emote = EMOTES.find((candidate) => candidate.lifetime === lifetime);
	if (!emote) throw new Error(`catalog needs a ${lifetime} fixture`);
	return emote;
};

describe('Emote catalog laws', () => {
	test('ids are non-empty and unique, lifetimes are known, and oneshots have duration', () => {
		expect(EMOTES.length).toBeGreaterThan(0);
		expect(new Set(EMOTES.map(({ id }) => id)).size).toBe(EMOTES.length);
		for (const emote of EMOTES) {
			expect(emote.id.length).toBeGreaterThan(0);
			expect(['oneshot', 'loop', 'hold']).toContain(emote.lifetime);
			if (emote.lifetime === 'oneshot')
				expect(emote.duration).toBeGreaterThan(0);
		}
	});

	test('lookup resolves every configured id and rejects unknown ids', () => {
		for (const emote of EMOTES) expect(emoteById(emote.id)).toBe(emote);
		expect(emoteById('not-configured')).toBeUndefined();
	});

	test('initial clocks follow lifetime semantics', () => {
		for (const emote of EMOTES)
			expect(initialEmoteT(emote)).toBe(
				emote.lifetime === 'oneshot' ? emote.duration : 0,
			);
	});
});

describe('Emote stepping laws', () => {
	test('oneshots count down and expire', () => {
		const emote = emoteWith('oneshot');
		const remaining = emote.duration / 2;
		expect(stepEmote(emote.id, emote.duration, false, remaining)).toEqual({
			emoteId: emote.id,
			emoteT: remaining,
		});
		expect(stepEmote(emote.id, remaining, false, remaining)).toEqual({
			emoteId: null,
			emoteT: 0,
		});
	});

	test('loop and hold clocks accumulate without timing out', () => {
		for (const lifetime of ['loop', 'hold'] as const) {
			const emote = emoteWith(lifetime);
			expect(stepEmote(emote.id, 2, false, 0.25)).toEqual({
				emoteId: emote.id,
				emoteT: 2.25,
			});
		}
	});

	test('acting, unknown ids, and absent ids return to idle', () => {
		const known = EMOTES[0].id;
		for (const [id, acting] of [
			[known, true],
			['not-configured', false],
			[undefined, false],
		] as const)
			expect(stepEmote(id, 1, acting, 0.1)).toEqual({
				emoteId: null,
				emoteT: 0,
			});
	});
});

test('movement and every combat or reaction state interrupt an Emote', () => {
	const rest = { vx: 0, attackT: 0 };
	expect(emoteInterrupted(rest)).toBe(false);
	for (const active of [
		{ vx: -1 },
		{ attackT: 0.1 },
		{ dodgeT: 0.1 },
		{ guardT: 0.1 },
		{ stunT: 0.1 },
	])
		expect(emoteInterrupted({ ...rest, ...active })).toBe(true);
});
