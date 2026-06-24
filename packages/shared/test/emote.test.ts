import { expect, test } from 'bun:test';
import { EMOTES, emoteById, emoteInterrupted, stepEmote } from '../src';

test('EMOTES is a non-empty fixed set of distinct ids with a timed lifetime', () => {
	expect(EMOTES.length).toBeGreaterThan(0);
	const ids = EMOTES.map((e) => e.id);
	expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
	for (const e of EMOTES) {
		expect(e.id.length).toBeGreaterThan(0);
		// This slice ships oneshot only; every emote plays for a positive duration.
		expect(e.lifetime).toBe('oneshot');
		expect(e.duration).toBeGreaterThan(0);
	}
});

test('the launch set includes the oneshot wave (ADR 0020 §8)', () => {
	const wave = emoteById('wave');
	expect(wave?.lifetime).toBe('oneshot');
	expect((wave?.duration ?? 0) > 0).toBe(true);
});

test('emoteById resolves a known id and is undefined for an unknown one', () => {
	const first = EMOTES[0];
	expect(emoteById(first.id)).toEqual(first);
	expect(emoteById('definitely-not-an-emote')).toBeUndefined();
});

// The pure emote-state machine the owner predicts and the server runs identically
// (ADR 0020 §9). These lock in the precedence-ladder cancel and the oneshot lifetime.
test('stepEmote counts a oneshot down while the Avatar stands still', () => {
	const r = stepEmote('wave', 1.0, false, 0.25);
	expect(r.emoteId).toBe('wave');
	expect(r.emoteT).toBeCloseTo(0.75);
});

test('stepEmote returns to idle once the oneshot timer elapses (ADR 0020 §8)', () => {
	const r = stepEmote('wave', 0.1, false, 0.25); // dt overshoots the remaining time
	expect(r.emoteId).toBeNull();
	expect(r.emoteT).toBe(0);
});

test('stepEmote cancels the emote the instant the Avatar acts (ADR 0020 §6/§9)', () => {
	// `acting` true (moving / combat / stagger) clears it even with time to spare, and it
	// does not resume — the cleared id is what the next tick steps from.
	const r = stepEmote('wave', 1.0, true, 0.05);
	expect(r.emoteId).toBeNull();
	expect(r.emoteT).toBe(0);
});

test('stepEmote is a no-op when there is no active emote', () => {
	expect(stepEmote(undefined, 0, false, 0.1)).toEqual({
		emoteId: null,
		emoteT: 0,
	});
});

test('emoteInterrupted: moving or any combat / reaction state outranks an emote', () => {
	const REST = { vx: 0, attackT: 0 };
	expect(emoteInterrupted(REST)).toBe(false);
	expect(emoteInterrupted({ ...REST, vx: -3 })).toBe(true); // moving (either direction)
	expect(emoteInterrupted({ ...REST, attackT: 0.2 })).toBe(true); // mid-swing
	expect(emoteInterrupted({ ...REST, dodgeT: 0.2 })).toBe(true); // dodging
	expect(emoteInterrupted({ ...REST, guardT: 0.2 })).toBe(true); // guarding
	expect(emoteInterrupted({ ...REST, stunT: 0.2 })).toBe(true); // Staggered
});
