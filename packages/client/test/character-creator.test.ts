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
import { CUSTOMIZE_FIELDS } from '../src/customize';

// The resolved Sprite top row, undoing previewAvatar's inverse of drawEntitySprite's
// placement (entity.y is offset up by BOX.h - PLAYER.h).
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
	// The anchor leaves VPAD + MAX_HAT_H rows above the Sprite regardless of hat, which
	// guarantees the tallest hat never clips. The nameplate reserves no headroom — it
	// sits below the Avatar (#103).
	const maxHatH = Math.max(0, ...HATS.map((h) => h.sprite?.h ?? 0));
	expect(spriteTopOf(0)).toBe(VPAD + maxHatH);
});

// --- Focused "name" input at Avatar creation (#304, #315, ADR 0028) ----------------
// Drives the creator headlessly (@opentui/core/testing). Typing flows through the REAL focused
// InputRenderable via `mockInput`; ↑/↓/Enter go through `creator.key`, the role index.ts's global
// keypress handler plays. Assertions are on the public surface, never private draft state.

const key = (name: string, sequence = ''): CreatorKey => ({
	name,
	sequence,
	ctrl: false,
	meta: false,
});

async function mountCreator(placeholder = 'wanderer') {
	const setup = await createTestRenderer({ width: 80, height: 30 });
	const cc = new CharacterCreator(
		setup.renderer,
		placeholder,
		DEFAULT_COSMETICS,
	);
	cc.attach(setup.renderer.root);
	cc.show(); // creation opens with the name row focused
	return {
		cc,
		type: (s: string) => setup.mockInput.typeText(s),
		backspace: () => setup.mockInput.pressBackspace(),
	};
}

test('creation opens with the name row focused', async () => {
	const { cc } = await mountCreator();
	expect(cc.focusedRow).toBe('name');
});

test('typing on the name row edits only the name; nothing else in the modal reacts', async () => {
	const { cc, type } = await mountCreator();
	await type('neo');
	expect(cc.effectiveName).toBe('neo');
	expect(cc.key(key('return'))).toEqual({
		handle: 'neo',
		cosmetics: DEFAULT_COSMETICS,
	});
});

test('confirm is blocked until the typed name passes the 2–16 rule, then returns it', async () => {
	const { cc, type } = await mountCreator();
	// One character is too short: confirm is disabled and Enter is a no-op.
	await type('a');
	expect(cc.confirmable).toBe(false);
	expect(cc.key(key('return'))).toBeNull();
	// A second character makes it valid; Enter now yields the name + cosmetics.
	await type('b');
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'ab',
		cosmetics: DEFAULT_COSMETICS,
	});
});

test('an illegal keystroke never lands in the name', async () => {
	const { cc, type } = await mountCreator();
	await type('ne');
	await type(' '); // a space is not a legal Handle character
	await type('!'); // nor is punctuation
	expect(cc.effectiveName).toBe('ne');
	await type('o'); // a legal character still lands
	expect(cc.effectiveName).toBe('neo');
});

test('backspace on the name row deletes from the draft and clears a standing rejection', async () => {
	const { cc, type, backspace } = await mountCreator();
	await type('neo');
	// The focused field owns deletion; its INPUT event must sync the draft back to the creator.
	await backspace();
	expect(cc.effectiveName).toBe('ne');
	// A backspace is also an edit, so it clears a standing server rejection.
	cc.showRejection('taken');
	expect(cc.errorMessage).toBe('that name is taken');
	await backspace();
	expect(cc.effectiveName).toBe('n');
	expect(cc.errorMessage).toBe('');
});

test('confirming an empty field uses the auto-derived placeholder', async () => {
	const { cc } = await mountCreator('wanderer');
	// No typing: the (valid) placeholder is used, so confirm is allowed immediately.
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'wanderer',
		cosmetics: DEFAULT_COSMETICS,
	});
});

test('↑/↓ move focus between the name row and the cosmetic rows', async () => {
	const { cc } = await mountCreator();
	expect(cc.focusedRow).toBe('name');
	// Down leaves the name row for the first cosmetic; up returns to it.
	cc.key(key('down'));
	expect(cc.focusedRow).not.toBe('name');
	const firstCosmetic = cc.focusedRow;
	cc.key(key('up'));
	expect(cc.focusedRow).toBe('name');
	// Down again lands back on the same first cosmetic row (stable ladder order).
	cc.key(key('down'));
	expect(cc.focusedRow).toBe(firstCosmetic);
});

test('on a cosmetic row left/right cycle the cosmetic, not the text cursor', async () => {
	const { cc } = await mountCreator();
	cc.key(key('down')); // focus the first cosmetic row
	cc.key(key('right')); // cycle it
	const result = cc.key(key('return'));
	// Confirm rode the cosmetic change, so the look differs from the default.
	expect(result?.cosmetics).not.toEqual(DEFAULT_COSMETICS);
});

test('a createRejected surfaces a transient "name" error, cleared on the next edit', async () => {
	const { cc, type } = await mountCreator();
	await type('neo');
	cc.setBusy(true); // frozen while the createAvatar is in flight
	cc.showRejection('taken');
	expect(cc.open).toBe(true);
	expect(cc.errorMessage).toBe('that name is taken');
	// Editing the name again clears the transient error so the retry reads clean.
	await type('x');
	expect(cc.errorMessage).toBe('');
});

// --- In-game re-customization: cosmetics-only mode (#305, ADR 0028) ----------------
// The SAME creator reopened with `editableHandle = false`: the Handle is set-once and read-only,
// and only Cosmetics change.

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
	expect(cc.confirmable).toBe(true);
	// Typing / backspace can't edit the set-once Handle — each is inert, returns null.
	expect(cc.key(key('z', 'z'))).toBeNull();
	expect(cc.key(key('backspace'))).toBeNull();
	expect(cc.key(key('return'))).toEqual({ handle: 'Neo', cosmetics: SEED });
});

test('re-customize edits cosmetics only; a picker change rides the confirm, the Handle never does', async () => {
	const cc = await mountRecustomize();
	expect(cc.key(key('right'))).toBeNull();
	const result = cc.key(key('return'));
	expect(result?.handle).toBe('Neo');
	expect(result?.cosmetics).not.toEqual(SEED);
});

test('reopen re-seeds the picker to the latest cosmetics for the next [c] press', async () => {
	const cc = await mountRecustomize('Neo', DEFAULT_COSMETICS);
	// The next open must start from the CURRENT cosmetics, not the ones it launched with.
	cc.reopen(SEED);
	expect(cc.key(key('return'))).toEqual({ handle: 'Neo', cosmetics: SEED });
});

// --- Re-customize is cosmetics-only: no name row (#318, ADR 0028) -------------------
// The name row is dropped from the ladder ENTIRELY in re-customize — not merely read-only. These
// assert on the public focus surface that no navigation ever lands on a name row.

test('re-customize opens on the first cosmetic row, with no name row in the ladder', async () => {
	const cc = await mountRecustomize();
	expect(cc.focusedRow).not.toBe('name');
	expect(cc.focusedRow).toBe(CUSTOMIZE_FIELDS[0].key);
});

test('re-customize ladder navigation never reaches a name row', async () => {
	const cc = await mountRecustomize();
	// Walk the whole ladder both ways; it's cosmetic rows only, so 'name' never appears.
	const seen = new Set<string>();
	for (let i = 0; i < CUSTOMIZE_FIELDS.length + 1; i++) {
		seen.add(cc.focusedRow);
		cc.key(key('down'));
	}
	for (let i = 0; i < CUSTOMIZE_FIELDS.length + 1; i++) {
		seen.add(cc.focusedRow);
		cc.key(key('up'));
	}
	expect(seen.has('name')).toBe(false);
	expect(seen).toEqual(new Set(CUSTOMIZE_FIELDS.map((f) => f.key)));
});

test('creation, by contrast, keeps the name row in the ladder (no regression)', async () => {
	const { cc } = await mountCreator();
	expect(cc.focusedRow).toBe('name');
	cc.key(key('down'));
	expect(cc.focusedRow).not.toBe('name');
	cc.key(key('up'));
	expect(cc.focusedRow).toBe('name');
});

test('re-customize confirm (save) is always allowed and returns the chosen cosmetics', async () => {
	const cc = await mountRecustomize('Neo', DEFAULT_COSMETICS);
	// No name to validate, so save is allowed immediately, handing back the durable Handle.
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'Neo',
		cosmetics: DEFAULT_COSMETICS,
	});
});
