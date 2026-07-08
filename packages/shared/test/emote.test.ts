import { expect, test } from 'bun:test';
import {
	EMOTE_FPS,
	EMOTES,
	emoteById,
	emoteInterrupted,
	initialEmoteT,
	stepEmote,
} from '../src';

test('EMOTES is a non-empty fixed set of distinct ids with a known lifetime', () => {
	expect(EMOTES.length).toBeGreaterThan(0);
	const ids = EMOTES.map((e) => e.id);
	expect(new Set(ids).size).toBe(ids.length);
	for (const e of EMOTES) {
		expect(e.id.length).toBeGreaterThan(0);
		expect(['oneshot', 'loop', 'hold']).toContain(e.lifetime);
		// A oneshot needs a positive duration to play; a persistent loop/hold ignores it.
		if (e.lifetime === 'oneshot') expect(e.duration).toBeGreaterThan(0);
	}
});

test('the launch set covers all three lifetime modes (ADR 0020 §8)', () => {
	expect(emoteById('wave')?.lifetime).toBe('oneshot');
	expect((emoteById('wave')?.duration ?? 0) > 0).toBe(true);
	expect(emoteById('dance')?.lifetime).toBe('loop');
	expect(emoteById('sit')?.lifetime).toBe('hold');
});

test('initialEmoteT seeds a oneshot countdown but a loop/hold elapsed clock at 0', () => {
	const wave = emoteById('wave');
	const dance = emoteById('dance');
	const sit = emoteById('sit');
	if (!wave || !dance || !sit) throw new Error('launch emotes missing');
	expect(initialEmoteT(wave)).toBe(wave.duration);
	expect(initialEmoteT(dance)).toBe(0);
	expect(initialEmoteT(sit)).toBe(0);
});

test('emoteById resolves a known id and is undefined for an unknown one', () => {
	const first = EMOTES[0];
	expect(emoteById(first.id)).toEqual(first);
	expect(emoteById('definitely-not-an-emote')).toBeUndefined();
});

// The pure emote-state machine the owner predicts and the server runs identically (ADR 0020 §9).
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

test('stepEmote accumulates a loop/hold elapsed clock and never times out', () => {
	// A loop/hold's emoteT counts UP as elapsed sim-time (the opposite of a oneshot's
	// countdown) and never auto-clears, even far past any oneshot duration.
	let s = { emoteId: 'dance' as string | null, emoteT: 0 };
	for (let i = 0; i < 100; i++) s = stepEmote(s.emoteId, s.emoteT, false, 0.1);
	expect(s.emoteId).toBe('dance');
	expect(s.emoteT).toBeCloseTo(10); // 100 × 0.1s of elapsed time, no auto-clear
	// hold behaves identically in the state machine (the frame freeze is in bodyFrame).
	expect(stepEmote('sit', 5, false, 0.1).emoteId).toBe('sit');
});

test('a loop emote frame is a deterministic function of elapsed sim-time — owner and observers agree (ADR 0020 §9)', () => {
	// The loop frame is a pure function of the replicated emoteT, so an owner who stepped
	// the clock by uneven dt and an observer who only received the snapshot compute the
	// same frame for any FPS.
	const frame = (t: number) => Math.floor(Math.max(0, t) * EMOTE_FPS);
	let owner = { emoteId: 'dance' as string | null, emoteT: 0 };
	for (const dt of [0.07, 0.13, 0.05])
		owner = stepEmote(owner.emoteId, owner.emoteT, false, dt);
	expect(owner.emoteT).toBeCloseTo(0.25);
	expect(frame(owner.emoteT)).toBe(frame(0.25));
});

test('stepEmote drops an unknown (forward-version) emote id rather than posing it', () => {
	expect(stepEmote('not-a-real-emote', 0.5, false, 0.1)).toEqual({
		emoteId: null,
		emoteT: 0,
	});
});

test('stepEmote cancels the emote the instant the Avatar acts (ADR 0020 §6/§9)', () => {
	// `acting` clears the emote even with time to spare, and it does not resume — the
	// cleared id is what the next tick steps from.
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
