import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { BOX, boxOf, clearSpriteBoxes, npcBoxOf } from '@mmo/core/entities';
import {
	defaultFrameBox,
	registerDerivedBoxes,
	spriteBoxes,
} from '../src/sprite-box';
import { loadAssetEntries } from '../src/store';
import { zonesFromEntries } from '../src/zones';
import { CATALOGS_JSON, FIELD_TEXT } from './fixtures';

// The suite preload registers the real derived boxes; these laws own the
// registry for their duration and hand the real ones back when done.
beforeEach(() => clearSpriteBoxes());
afterAll(() => registerDerivedBoxes(loadAssetEntries()));

const PADDED = `{
	"animations": [{ "name": "idle" }, { "name": "windup" }]
}
--- idle
·······
·▗▄▄▖··
·████··
·······
@colors
·······
·pppp··
·pppp··
·······
--- windup 0
▄▄▄▄▄▄▄
███████
███████
███████
--- windup 1
·······
·······
·······
····█··
`;

describe('defaultFrameBox', () => {
	test('is the visible-pixel bounds of the Default frame, not the grid', () => {
		expect(defaultFrameBox(PADDED)).toEqual({ w: 4, h: 2 });
	});

	test('ignores other frames entirely', () => {
		const tall = PADDED.replace('····█··', '█······');
		expect(defaultFrameBox(tall)).toEqual({ w: 4, h: 2 });
	});

	test('binds the Default frame by the header order, not section order', () => {
		const headerFirst = `{"animations":[{"name":"attack"},{"name":"idle"}]}
--- idle
██
--- attack 0
█████
█████
█████
--- attack 1
█
`;
		expect(defaultFrameBox(headerFirst)).toEqual({ w: 5, h: 3 });
	});

	test('yields nothing for unparseable or fully transparent sprites', () => {
		expect(defaultFrameBox('not a sprite')).toBeNull();
		expect(
			defaultFrameBox('{"animations":[{"name":"idle"}]}\n--- idle\n··\n'),
		).toBeNull();
	});

	test('agrees with the shipped monster art', () => {
		const entries = loadAssetEntries();
		const boxes = spriteBoxes('monsters', entries);
		expect(boxes.get('slime')).toEqual({ w: 7, h: 4 });
		expect(boxes.get('chaser')).toEqual({ w: 6, h: 5 });
		expect(boxes.get('shooter')).toEqual({ w: 7, h: 5 });
		expect(boxes.get('brute')).toEqual({ w: 7, h: 6 });
		expect(spriteBoxes('npcs', entries).get('merchant')).toEqual({
			w: 6,
			h: 5,
		});
	});
});

describe('registration at asset load', () => {
	test('registerDerivedBoxes threads monster and NPC boxes into the core catalog', () => {
		registerDerivedBoxes(loadAssetEntries());
		expect(boxOf('slime')).toEqual({ w: 7, h: 4 });
		expect(boxOf('brute')).toEqual({ w: 7, h: 6 });
		expect(npcBoxOf('vendor')).toEqual({ w: 6, h: 5 });
		expect(boxOf('player')).toBe(BOX);
	});

	test('zone loading registers before the first spawn is stamped', () => {
		const sprites = Object.fromEntries(
			Object.entries(loadAssetEntries()).filter(([k]) =>
				k.startsWith('sprites/'),
			),
		);
		const entries = {
			...sprites,
			'zones/catalogs.json': CATALOGS_JSON,
			'zones/f.zone': FIELD_TEXT,
		};
		const zone = zonesFromEntries(entries).find((z) => z.id === 'f');
		const m = zone?.monsters[0];
		// The fixture's spawn slot is at (4, 3): the chaser's derived 6x5 box
		// keeps the slot's floor under its feet.
		expect(m).toMatchObject({ type: 'chaser', y: 3 + BOX.h - 5 });
		expect(m?.x).toBe(4 + Math.floor((BOX.w - 6) / 2));
	});
});
