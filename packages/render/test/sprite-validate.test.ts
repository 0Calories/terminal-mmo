import { expect, test } from 'bun:test';
import { loadSpriteSources, type SpriteSource } from '@mmo/assets';
import { WEAPONS } from '@mmo/core/combat';
import { SHIELDS } from '@mmo/core/items';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '@mmo/core/sprites';
import { parseSpriteFile, type SpriteDoc } from '../src';
import {
	acceptSprite,
	validatePixelOnlyArt,
	validateSpriteRole,
	validateSpriteSet,
} from '../src/sprite-validate';

function docOf(text: string, id = 's'): SpriteDoc {
	const { doc, diagnostics } = parseSpriteFile(text, id);
	if (doc === null)
		throw new Error(`parse failed: ${JSON.stringify(diagnostics)}`);
	return doc;
}

const FORMS_OK = `{
	"anchors": { "grip": [1, 0], "head": [0, 0], "offhand": [0, 1] },
	"animations": [{ "name": "idle" }, { "name": "walk" }]
}
--- idle
AB
CD
--- walk 0
AB
CD
--- walk 1
AB
CD
`;

test('validateSpriteRole: forms passes with idle/walk and grip/head', () => {
	expect(validateSpriteRole(docOf(FORMS_OK, 'buddy'), 'forms')).toEqual([]);
});

const FORMS_BAD = `{
	"anchors": { "grip": [1, 0] },
	"animations": [{ "name": "idle" }]
}
--- idle
AB
CD
`;

test('validateSpriteRole: forms fails naming missing animation and anchor', () => {
	const diags = validateSpriteRole(docOf(FORMS_BAD, 'buddy'), 'forms');
	expect(diags.every((d) => d.severity === 'error')).toBe(true);
	expect(diags.every((d) => d.spriteId === 'buddy')).toBe(true);
	const joined = diags.map((d) => d.message).join('\n');
	expect(joined).toContain("'walk'");
	expect(joined).toContain('head');
	expect(joined).toContain('buddy');
	expect(joined).toContain('forms');

	expect(joined).not.toContain("'idle'");
});

const FORMS_NO_OFFHAND = `{
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "walk" }]
}
--- idle
AB
CD
--- walk 0
AB
CD
--- walk 1
AB
CD
`;

test('validateSpriteRole: a form without the offhand anchor is an error', () => {
	const diags = validateSpriteRole(docOf(FORMS_NO_OFFHAND, 'buddy'), 'forms');
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('error');
	expect(diags[0].message).toContain("'offhand'");
});

const FORMS_KNOWN_EMOTE = `{
	"anchors": { "grip": [1, 0], "head": [0, 0], "offhand": [0, 1] },
	"animations": [{ "name": "idle" }, { "name": "walk" }, { "name": "emote:wave" }]
}
--- idle
AB
--- walk 0
AB
--- walk 1
AB
--- emote:wave
AB
`;

test('validateSpriteRole: forms accepts an emote animation for a registered emote', () => {
	expect(
		validateSpriteRole(docOf(FORMS_KNOWN_EMOTE, 'buddy'), 'forms'),
	).toEqual([]);
});

const FORMS_UNKNOWN_EMOTE = `{
	"anchors": { "grip": [1, 0], "head": [0, 0], "offhand": [0, 1] },
	"animations": [{ "name": "idle" }, { "name": "walk" }, { "name": "emote:boogie" }]
}
--- idle
AB
--- walk 0
AB
--- walk 1
AB
--- emote:boogie
AB
`;

test('validateSpriteRole: forms rejects an emote animation for an unregistered emote', () => {
	const diags = validateSpriteRole(
		docOf(FORMS_UNKNOWN_EMOTE, 'buddy'),
		'forms',
	);
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('error');
	expect(diags[0].message).toContain('boogie');
	expect(diags[0].message).toContain('unknown emote');
});

const FORMS_NON_IDLE_LEAD = `{
	"anchors": { "grip": [1, 0], "head": [0, 0], "offhand": [0, 1] },
	"animations": [{ "name": "walk" }, { "name": "idle" }]
}
--- walk 0
AB
--- walk 1
AB
--- idle
AB
`;

test('validateSpriteRole: a form whose first animation is not idle warns rather than errors', () => {
	const diags = validateSpriteRole(
		docOf(FORMS_NON_IDLE_LEAD, 'buddy'),
		'forms',
	);
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('warning');
	expect(diags[0].message).toContain('idle');

	expect(validateSpriteRole(docOf(FORMS_OK, 'buddy'), 'forms')).toEqual([]);
});

const WEAPON_OK = `{
	"accent": "s",
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "swing" }]
}
--- idle
AB
--- swing 0
AB
--- swing 1
AB
--- swing 2
AB
`;

test('validateSpriteRole: weapons passes with a default frame + a 3-frame swing and grip', () => {
	expect(validateSpriteRole(docOf(WEAPON_OK, 'sword'), 'weapons')).toEqual([]);
});

const WEAPON_BAD = `{
	"animations": [{ "name": "idle" }, { "name": "chop" }]
}
--- idle
AB
--- chop
AB
`;

test('validateSpriteRole: weapons fails on missing swing animation and grip anchor', () => {
	const diags = validateSpriteRole(docOf(WEAPON_BAD, 'sword'), 'weapons');
	expect(diags.length).toBe(2);
	const joined = diags.map((d) => d.message).join('\n');
	expect(joined).toContain('swing');
	expect(joined).toContain('grip');
});

const WEAPON_SHORT_SWING = `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "swing" }]
}
--- idle
AB
--- swing 0
AB
--- swing 1
AB
`;

test('validateSpriteRole: a swing of other than exactly 3 frames is an error', () => {
	const diags = validateSpriteRole(
		docOf(WEAPON_SHORT_SWING, 'sword'),
		'weapons',
	);
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('error');
	expect(diags[0].message).toContain('exactly 3');
});

const WEAPON_NO_REST = `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "swing" }]
}
--- swing 0
AB
--- swing 1
AB
--- swing 2
AB
`;

test('validateSpriteRole: a weapon whose first animation is swing has no rest frame', () => {
	const diags = validateSpriteRole(docOf(WEAPON_NO_REST, 'sword'), 'weapons');
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('error');
	expect(diags[0].message).toContain('rest');
	expect(diags[0].message).toContain('swing');
});

const SHIELD_OK = `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "block" }]
}
--- idle
AB
--- block
AB
`;

test('validateSpriteRole: shields passes with a rest Default frame, block, and grip', () => {
	expect(validateSpriteRole(docOf(SHIELD_OK, 'shield'), 'shields')).toEqual([]);
});

const SHIELD_BAD = `{
	"animations": [{ "name": "idle" }]
}
--- idle
AB
`;

test('validateSpriteRole: shields fails on missing block animation and grip anchor', () => {
	const diags = validateSpriteRole(docOf(SHIELD_BAD, 'shield'), 'shields');
	expect(diags.length).toBe(2);
	const joined = diags.map((d) => d.message).join('\n');
	expect(joined).toContain("'block'");
	expect(joined).toContain("'grip'");
});

const SHIELD_PHASED_BLOCK = `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "block" }]
}
--- idle
AB
--- block 0
AB
--- block 1
AB
`;

test('validateSpriteRole: a multi-frame block without fps is phase-shaped and fails', () => {
	const diags = validateSpriteRole(
		docOf(SHIELD_PHASED_BLOCK, 'shield'),
		'shields',
	);
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('error');
	expect(diags[0].message).toContain('held state');
});

const SHIELD_LOOPED_BLOCK = `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "block", "fps": 4 }]
}
--- idle
AB
--- block 0
AB
--- block 1
AB
`;

test('validateSpriteRole: a multi-frame block with fps is a held loop and passes', () => {
	expect(
		validateSpriteRole(docOf(SHIELD_LOOPED_BLOCK, 'shield'), 'shields'),
	).toEqual([]);
});

const SHIELD_NO_REST = `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "block" }]
}
--- block
AB
`;

test('validateSpriteRole: a shield whose first animation is block has no rest carry', () => {
	const diags = validateSpriteRole(docOf(SHIELD_NO_REST, 'shield'), 'shields');
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('error');
	expect(diags[0].message).toContain('rest-carry');
});

const idleText = `{ "animations": [{ "name": "idle" }] }\n--- idle\n██\n`;
const nonIdleText = `{ "animations": [{ "name": "x" }] }\n--- x\n██\n`;

test('validateSpriteRole: hats/monsters/npcs require only idle', () => {
	for (const role of ['hats', 'monsters', 'npcs']) {
		expect(validateSpriteRole(docOf(idleText, 'h'), role)).toEqual([]);
		const bad = validateSpriteRole(docOf(nonIdleText, 'h'), role);
		expect(bad.length).toBe(1);
		expect(bad[0].severity).toBe('error');
		expect(bad[0].message).toContain('idle');
	}
});

test('validateSpriteRole: unknown role is a warning', () => {
	const diags = validateSpriteRole(docOf(idleText, 'x'), 'bogus');
	expect(diags.length).toBe(1);
	expect(diags[0].severity).toBe('warning');
	expect(diags[0].message).toContain('bogus');
});

test('acceptSprite: returns the parsed doc for a source that parses cleanly and satisfies its role', () => {
	const source: SpriteSource = { id: 'buddy', role: 'forms', text: FORMS_OK };
	const doc = acceptSprite(source, 'forms');
	expect(doc).not.toBeNull();
	expect(doc?.id).toBe('buddy');
});

test('acceptSprite: returns null for a source that fails its role profile', () => {
	const source: SpriteSource = { id: 'buddy', role: 'forms', text: FORMS_BAD };
	expect(acceptSprite(source, 'forms')).toBeNull();
});

test('acceptSprite: returns null for a source that fails to parse', () => {
	const source: SpriteSource = {
		id: 'broken',
		role: 'hats',
		text: 'not valid json {{{',
	};
	expect(acceptSprite(source, 'hats')).toBeNull();
});

test('validateSpriteSet: aggregates parse diagnostics and role-profile diagnostics', () => {
	const sources: SpriteSource[] = [
		{ id: 'good-hat', role: 'hats', text: idleText },
		{ id: 'bad-hat', role: 'hats', text: nonIdleText },
		{ id: 'broken', role: 'hats', text: 'not valid json {{{' },
	];
	const diags = validateSpriteSet(sources);

	expect(diags.some((d) => d.spriteId === 'broken')).toBe(true);
	expect(
		diags.some((d) => d.spriteId === 'bad-hat' && d.message.includes('idle')),
	).toBe(true);
	expect(diags.some((d) => d.spriteId === 'good-hat')).toBe(false);
});

test('validateSpriteSet: a parse failure is reported but the role check is skipped', () => {
	const diags = validateSpriteSet([
		{ id: 'broken', role: 'forms', text: 'not valid json {{{' },
	]);

	const brokenDiags = diags.filter((d) => d.spriteId === 'broken');
	expect(brokenDiags.length).toBeGreaterThan(0);

	expect(brokenDiags.some((d) => d.message.includes('missing'))).toBe(false);
});

function weaponSource(id: string): SpriteSource {
	return {
		id,
		role: 'weapons',
		text: `{"anchors":{"grip":[0,0]},"animations":[{"name":"idle"},{"name":"swing"}]}
--- idle
AB
--- swing 0
AB
--- swing 1
AB
--- swing 2
AB
`,
	};
}

function idleSource(id: string, role: string): SpriteSource {
	return { id, role, text: idleText };
}

function shieldSource(id: string): SpriteSource {
	return {
		id,
		role: 'shields',
		text: `{
	"anchors": { "grip": [0, 0] },
	"animations": [{ "name": "idle" }, { "name": "block" }]
}
--- idle
AB
--- block
AB
`,
	};
}

test('validateSpriteSet: dangling weapon/monster/npc catalog references are errors', () => {
	const diags = validateSpriteSet([]);
	const errs = diags.filter((d) => d.severity === 'error');
	const referenced = new Set([
		...WEAPONS.map((weapon) => weapon.sprite),
		...SHIELDS.map((shield) => shield.sprite),
		...Object.values(MONSTER_SPRITE_REF),
		...Object.values(NPC_SPRITE_REF),
	]);
	for (const id of referenced) {
		const diagnostic = errs.find((entry) => entry.spriteId === id);
		expect(diagnostic).toBeDefined();
		expect(diagnostic?.message).toContain(id);
	}
});

test('validateSpriteSet: resolved catalog references produce no dangling-reference error', () => {
	const sourcesByRoleAndId = new Map<string, SpriteSource>();
	for (const weapon of WEAPONS) {
		const source = weaponSource(weapon.sprite);
		sourcesByRoleAndId.set(`${source.role}:${source.id}`, source);
	}
	for (const shield of SHIELDS) {
		const source = shieldSource(shield.sprite);
		sourcesByRoleAndId.set(`${source.role}:${source.id}`, source);
	}
	for (const id of Object.values(MONSTER_SPRITE_REF)) {
		const source = idleSource(id, 'monsters');
		sourcesByRoleAndId.set(`${source.role}:${source.id}`, source);
	}
	for (const id of Object.values(NPC_SPRITE_REF)) {
		const source = idleSource(id, 'npcs');
		sourcesByRoleAndId.set(`${source.role}:${source.id}`, source);
	}
	const sources = [...sourcesByRoleAndId.values()];
	const diags = validateSpriteSet(sources);

	expect(diags.some((d) => d.message.includes('resolves'))).toBe(false);
});

test('validateSpriteSet: an unresolvable color key is an error, not a silent fallback', () => {
	const src: SpriteSource = {
		id: 'badcol',
		role: 'hats',
		text: `{"colors":{"q":[1,2,3,255]},"animations":[{"name":"idle"}]}\n--- idle\nAB\n@colors\nqz\n`,
	};
	const diags = validateSpriteSet([src]);
	const err = diags.find(
		(d) =>
			d.spriteId === 'badcol' &&
			d.severity === 'error' &&
			d.message.includes('unknown color key'),
	);
	expect(err).toBeDefined();
	expect(err?.message).toContain('z');

	expect(
		diags.some(
			(d) =>
				d.spriteId === 'badcol' &&
				d.severity === 'warning' &&
				d.message.includes('unknown color key'),
		),
	).toBe(false);
});

const HAT_WITH_STAMP = `{ "animations": [{ "name": "idle" }] }
--- idle
·▲·
·█·
@colors
·y·
·m·
`;

test('validatePixelOnlyArt: a movement-capable role rejects an arbitrary Glyph stamp', () => {
	for (const role of ['forms', 'weapons', 'hats', 'monsters']) {
		const diags = validatePixelOnlyArt(docOf(HAT_WITH_STAMP, 'stampy'), role);
		const stamp = diags.find((d) => d.message.includes('Glyph stamp'));
		expect(stamp).toBeDefined();
		expect(stamp?.severity).toBe('error');
		expect(stamp?.spriteId).toBe('stampy');
		expect(stamp?.frame).toBe('idle');
		expect(stamp?.cell).toEqual({ x: 1, y: 0 });
		expect(stamp?.message).toContain("'▲'");
		expect(stamp?.message).toContain(role);
	}
});

test('validatePixelOnlyArt: quadrant/half-block art in a moving role is accepted', () => {
	const doc = docOf(
		`{ "animations": [{ "name": "idle" }] }\n--- idle\n▄█▄\n█▀█\n`,
		'ok',
	);
	expect(validatePixelOnlyArt(doc, 'hats')).toEqual([]);
});

test('validatePixelOnlyArt: npcs are not movement-capable, so Glyph stamps are allowed', () => {
	expect(
		validatePixelOnlyArt(docOf(HAT_WITH_STAMP, 'shopkeep'), 'npcs'),
	).toEqual([]);
});

test('validateSpriteSet: the shipped moving-role sprites carry no arbitrary Glyph stamps', () => {
	const diags = validateSpriteSet(loadSpriteSources().values());
	expect(diags.some((d) => d.message.includes('Glyph stamp'))).toBe(false);
});

test('validateSpriteSet: an arbitrary stamp in a moving role aggregates as an error', () => {
	const diags = validateSpriteSet([
		{ id: 'stampy', role: 'hats', text: HAT_WITH_STAMP },
	]);
	const stamp = diags.find(
		(d) => d.spriteId === 'stampy' && d.message.includes('Glyph stamp'),
	);
	expect(stamp).toBeDefined();
	expect(stamp?.severity).toBe('error');
});

test('validateSpriteSet: reserved p/a redefinition surfaces as an aggregated error', () => {
	const src: SpriteSource = {
		id: 'reserved',
		role: 'hats',
		text: `{"colors":{"p":[1,2,3,255]},"animations":[{"name":"idle"}]}\n--- idle\nAB\n`,
	};
	const diags = validateSpriteSet([src]);
	expect(
		diags.some(
			(d) =>
				d.spriteId === 'reserved' &&
				d.severity === 'error' &&
				d.message.includes("reserved recolor key 'p'"),
		),
	).toBe(true);
});

const MONSTER_UNIFORM = `{"key":"f","animations":[{"name":"idle"},{"name":"windup"}]}
--- idle
·▄▄·
████
--- windup 0
····
████
--- windup 1
▄▄▄▄
████
`;

test('validateSpriteRole: a derived-box sprite with uniform frame grids passes', () => {
	expect(
		validateSpriteRole(docOf(MONSTER_UNIFORM, 'blob'), 'monsters'),
	).toEqual([]);
});

const MONSTER_RESIZED = `{"key":"f","animations":[{"name":"idle"},{"name":"windup"}]}
--- idle
·▄▄·
████
--- windup
▄▄▄▄▄▄
██████
`;

test('validateSpriteRole: a frame grid differing from the Default frame is an error', () => {
	const diags = validateSpriteRole(docOf(MONSTER_RESIZED, 'blob'), 'monsters');
	const bad = diags.find((d) => d.frame === 'windup');
	expect(bad?.severity).toBe('error');
	expect(bad?.message).toContain('one sizing');
	expect(bad?.message).toContain('6x2');
	expect(bad?.message).toContain('4x2');
});

test('validateSpriteRole: the uniform-grid rule gates acceptance, so a resized monster is refused', () => {
	expect(
		acceptSprite(
			{ id: 'blob', role: 'monsters', text: MONSTER_RESIZED },
			'monsters',
		),
	).toBeNull();
});

const MONSTER_WILD = `{"key":"f","animations":[{"name":"idle"},{"name":"attack"}]}
--- idle
··········
··▄▄▄▄····
··········
--- attack 0
··········
··██████··
··········
--- attack 1
██████████
██████████
██████████
`;

test('validateSpriteRole: visible art wildly past the Default frame warns; a modest stretch does not', () => {
	const diags = validateSpriteRole(docOf(MONSTER_WILD, 'blob'), 'monsters');
	expect(diags.filter((d) => d.frame === 'attack 0')).toEqual([]);
	const wild = diags.find((d) => d.frame === 'attack 1');
	expect(wild?.severity).toBe('warning');
	expect(wild?.message).toContain('wildly');
});

test('validateSpriteRole: non-derived roles may resize freely between frames', () => {
	const form = `{
	"anchors": { "grip": [0, 0], "head": [0, 0], "offhand": [0, 1] },
	"animations": [{ "name": "idle" }, { "name": "walk" }]
}
--- idle
AB
--- walk 0
ABCD
EFGH
--- walk 1
AB
`;
	expect(
		validateSpriteRole(docOf(form, 'buddy'), 'forms').filter(
			(d) => d.severity === 'error',
		),
	).toEqual([]);
});

test('validateSpriteSet: the shipped set has no uniform-grid or box-derivation complaints', () => {
	const diags = validateSpriteSet(loadSpriteSources().values());
	expect(diags.some((d) => d.message.includes('logical box'))).toBe(false);
	expect(diags.some((d) => d.message.includes('one sizing'))).toBe(false);
	expect(diags.some((d) => d.message.includes('wildly'))).toBe(false);
});
