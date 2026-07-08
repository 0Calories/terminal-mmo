import { expect, test } from 'bun:test';
import { BOX, type Cosmetics, DEFAULT_COSMETICS, HATS } from '@mmo/shared';
import { createTestRenderer } from '@opentui/core/testing';
import {
	CharacterCreator,
	type CreatorKey,
	NAMEPLATE_H,
	PLAYER,
	PREVIEW_H,
	previewAvatar,
	VPAD,
} from '../src/character-creator';

// The resolved Sprite top row, undoing previewAvatar's inverse of drawEntitySprite's
// placement (entity.y is offset up by BOX.h - PLAYER.h so the Sprite lands at this row).
const spriteTopOf = (hat: number) =>
	previewAvatar({ hue: 0, hat, nameplate: 0, form: 0 }, 'name').y +
	(BOX.h - PLAYER.h);

test('cycling the hat keeps the Sprite anchored at a fixed vertical position', () => {
	const tops = HATS.map((_, hat) => spriteTopOf(hat));
	// Every hat selection resolves the Sprite to the same top row — only the hat above
	// it changes, so the body/feet never shift (the #104 anchoring bug).
	expect(new Set(tops).size).toBe(1);
});

test('no hat selection clips the stack at the top or bottom of the preview', () => {
	for (let hat = 0; hat < HATS.length; hat++) {
		const spriteTop = spriteTopOf(hat);
		const hatH = HATS[hat]?.sprite?.h ?? 0;
		const hatTop = spriteTop - hatH;
		// The nameplate sits below the feet (#103), so its bottom is the lowest row.
		const nameplateBottom = spriteTop + PLAYER.h + NAMEPLATE_H;
		expect(hatTop).toBeGreaterThanOrEqual(0); // tallest hat fits above
		expect(nameplateBottom).toBeLessThanOrEqual(PREVIEW_H); // nameplate fits below
	}
});

test('reserved headroom is fixed, so the Sprite sits below the tallest hat', () => {
	// The anchor leaves VPAD + MAX_HAT_H rows above the Sprite regardless of the current
	// hat, which is what guarantees the tallest hat never clips. The nameplate no longer
	// reserves headroom — it sits below the Avatar now (#103).
	const maxHatH = Math.max(0, ...HATS.map((h) => h.sprite?.h ?? 0));
	expect(spriteTopOf(0)).toBe(VPAD + maxHatH);
});

// --- Player-typed Handle at Avatar creation (#304, ADR 0028) -----------------------
// These drive the retained-UI creator headlessly through @opentui/core/testing (the repo's
// TTY-free path): construct it on a test renderer and feed key events, asserting the confirm
// gate + inline-rejection behaviour (the interactive logic, not the pixels).

const key = (name: string, sequence = ''): CreatorKey => ({
	name,
	sequence,
	ctrl: false,
	meta: false,
});

async function mountCreator(placeholder = 'wanderer') {
	const { renderer } = await createTestRenderer({ width: 80, height: 30 });
	const cc = new CharacterCreator(renderer, placeholder, DEFAULT_COSMETICS);
	cc.attach(renderer.root);
	cc.show();
	return cc;
}

test('confirm is blocked until the typed Handle passes the 2–16 rule, then returns it', async () => {
	const cc = await mountCreator();
	// A one-character draft is too short: the confirm key is disabled and Enter is a no-op.
	expect(cc.key(key('a', 'a'))).toBeNull();
	expect(cc.confirmable).toBe(false);
	expect(cc.key(key('return'))).toBeNull();
	// A second character makes it valid: Enter now yields the typed Handle + chosen Cosmetics.
	expect(cc.key(key('b', 'b'))).toBeNull();
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'ab',
		cosmetics: DEFAULT_COSMETICS,
	});
});

test('confirming an empty field uses the auto-derived placeholder', async () => {
	const cc = await mountCreator('wanderer');
	// No typing: the (valid) placeholder is used, so confirm is allowed immediately.
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'wanderer',
		cosmetics: DEFAULT_COSMETICS,
	});
});

test('a createRejected keeps the creator open with an inline error, cleared on the next edit', async () => {
	const cc = await mountCreator();
	cc.key(key('n', 'n'));
	cc.key(key('e', 'e'));
	cc.key(key('o', 'o'));
	cc.setBusy(true); // frozen while the createAvatar is in flight
	expect(cc.key(key('x', 'x'))).toBeNull(); // input ignored while busy
	// The server refused the claim: the creator stays open, unfreezes, and shows why.
	cc.showRejection('taken');
	expect(cc.open).toBe(true);
	expect(cc.errorMessage.length).toBeGreaterThan(0);
	// Editing the Handle again clears the inline error so the retry reads clean.
	cc.key(key('backspace'));
	expect(cc.errorMessage).toBe('');
});

// --- In-game re-customization: cosmetics-only mode (#305, ADR 0028) ----------------
// The SAME creator reopened with `editableHandle = false`: the Handle is set-once and read-
// only, and only Cosmetics change. Drives it headlessly to assert the read-only Handle + the
// current-look seed + confirm returning cosmetics (the interactive logic, not the pixels).

const SEED: Cosmetics = { hue: 2, hat: 1, nameplate: 3, form: 0 };

async function mountRecustomize(handle = 'Neo', cosmetics = SEED) {
	const { renderer } = await createTestRenderer({ width: 80, height: 30 });
	const cc = new CharacterCreator(renderer, handle, cosmetics, false);
	cc.attach(renderer.root);
	cc.show();
	return cc;
}

test('re-customize seeds the current cosmetics and is confirmable immediately with a read-only Handle', async () => {
	const cc = await mountRecustomize();
	// The durable Handle is already valid, so confirm is allowed with no typing.
	expect(cc.confirmable).toBe(true);
	// Typing / backspace can't edit the set-once Handle (each is inert, returns null).
	expect(cc.key(key('z', 'z'))).toBeNull();
	expect(cc.key(key('backspace'))).toBeNull();
	// Confirm keeps the durable Handle and hands back the seeded (current) cosmetics unchanged.
	expect(cc.key(key('return'))).toEqual({ handle: 'Neo', cosmetics: SEED });
});

test('re-customize edits cosmetics only; a picker change rides the confirm, the Handle never does', async () => {
	const cc = await mountRecustomize();
	// Cycle the focused field, then confirm: the Handle is still the durable one and the
	// cosmetics reflect the change (so it differs from the seed).
	expect(cc.key(key('right'))).toBeNull();
	const result = cc.key(key('return'));
	expect(result?.handle).toBe('Neo');
	expect(result?.cosmetics).not.toEqual(SEED);
});

test('reopen re-seeds the picker to the latest cosmetics for the next [c] press', async () => {
	const cc = await mountRecustomize('Neo', DEFAULT_COSMETICS);
	// A previous session tweaked the look; the next open must start from the CURRENT cosmetics.
	cc.reopen(SEED);
	expect(cc.key(key('return'))).toEqual({ handle: 'Neo', cosmetics: SEED });
});
