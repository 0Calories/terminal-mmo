import { expect, test } from 'bun:test';
import { BOX, type Cosmetics, DEFAULT_COSMETICS } from '@mmo/core';
import { HAT_IDS, hatById } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import {
	CharacterCreator,
	type CreatorKey,
	NAMEPLATE_H,
	PLAYER,
	PREVIEW_H,
	previewAvatar,
	VPAD,
} from '../src/ui/character-creator';
import { CUSTOMIZE_FIELDS } from '../src/ui/customize';

// undo previewAvatar's inverse of drawEntitySprite's placement (offset up by BOX.h - PLAYER.h)
const spriteTopOf = (hat: string) =>
	previewAvatar({ hue: 0, hat, nameplate: 0, form: 'buddy' }, 'name').y +
	(BOX.h - PLAYER.h);

const ALL_HATS = ['', ...HAT_IDS];

test('cycling the hat keeps the Sprite anchored at a fixed vertical position', () => {
	const tops = ALL_HATS.map((hat) => spriteTopOf(hat));
	expect(new Set(tops).size).toBe(1);
});

test('no hat selection clips the stack at the top or bottom of the preview', () => {
	for (const hat of ALL_HATS) {
		const spriteTop = spriteTopOf(hat);
		const hatH = hatById(hat)?.h ?? 0;
		const hatTop = spriteTop - hatH;
		const nameplateBottom = spriteTop + PLAYER.h + NAMEPLATE_H;
		expect(hatTop).toBeGreaterThanOrEqual(0);
		expect(nameplateBottom).toBeLessThanOrEqual(PREVIEW_H);
	}
});

test('reserved headroom is fixed, so the Sprite sits below the tallest hat', () => {
	const maxHatH = Math.max(0, ...HAT_IDS.map((id) => hatById(id)?.h ?? 0));
	expect(spriteTopOf('')).toBe(VPAD + maxHatH);
});

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
	cc.show();
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
	await type('a');
	expect(cc.confirmable).toBe(false);
	expect(cc.key(key('return'))).toBeNull();
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
	await type(' ');
	await type('!');
	expect(cc.effectiveName).toBe('ne');
	await type('o');
	expect(cc.effectiveName).toBe('neo');
});

test('backspace on the name row deletes from the draft and clears a standing rejection', async () => {
	const { cc, type, backspace } = await mountCreator();
	await type('neo');
	await backspace();
	expect(cc.effectiveName).toBe('ne');
	cc.showRejection('taken');
	expect(cc.errorMessage).toBe('that name is taken');
	await backspace();
	expect(cc.effectiveName).toBe('n');
	expect(cc.errorMessage).toBe('');
});

test('confirming an empty field uses the auto-derived placeholder', async () => {
	const { cc } = await mountCreator('wanderer');
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'wanderer',
		cosmetics: DEFAULT_COSMETICS,
	});
});

test('↑/↓ move focus between the name row and the cosmetic rows', async () => {
	const { cc } = await mountCreator();
	expect(cc.focusedRow).toBe('name');
	cc.key(key('down'));
	expect(cc.focusedRow).not.toBe('name');
	const firstCosmetic = cc.focusedRow;
	cc.key(key('up'));
	expect(cc.focusedRow).toBe('name');
	cc.key(key('down'));
	expect(cc.focusedRow).toBe(firstCosmetic);
});

test('on a cosmetic row left/right cycle the cosmetic, not the text cursor', async () => {
	const { cc } = await mountCreator();
	cc.key(key('down'));
	cc.key(key('right'));
	const result = cc.key(key('return'));
	expect(result?.cosmetics).not.toEqual(DEFAULT_COSMETICS);
});

test('a createRejected surfaces a transient "name" error, cleared on the next edit', async () => {
	const { cc, type } = await mountCreator();
	await type('neo');
	cc.setBusy(true);
	cc.showRejection('taken');
	expect(cc.open).toBe(true);
	expect(cc.errorMessage).toBe('that name is taken');
	await type('x');
	expect(cc.errorMessage).toBe('');
});

const SEED: Cosmetics = { hue: 2, hat: 'cap', nameplate: 3, form: 'buddy' };

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
	cc.reopen(SEED);
	expect(cc.key(key('return'))).toEqual({ handle: 'Neo', cosmetics: SEED });
});

test('re-customize opens on the first cosmetic row, with no name row in the ladder', async () => {
	const cc = await mountRecustomize();
	expect(cc.focusedRow).not.toBe('name');
	expect(cc.focusedRow).toBe(CUSTOMIZE_FIELDS[0].key);
});

test('re-customize ladder navigation never reaches a name row', async () => {
	const cc = await mountRecustomize();
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
	expect(cc.confirmable).toBe(true);
	expect(cc.key(key('return'))).toEqual({
		handle: 'Neo',
		cosmetics: DEFAULT_COSMETICS,
	});
});
