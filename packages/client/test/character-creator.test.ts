import { expect, test } from 'bun:test';
import { BOX, HATS } from '@mmo/shared';
import {
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
