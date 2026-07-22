import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
import { WEAPONS } from '@mmo/core/combat';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '@mmo/core/sprites';
import { parseSpriteFile, type SpriteDoc } from '../src';
import {
	acceptSprite,
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

const FORMS_KNOWN_EMOTE = `{
	"anchors": { "grip": [1, 0], "head": [0, 0] },
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
	"anchors": { "grip": [1, 0], "head": [0, 0] },
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
	"anchors": { "grip": [1, 0], "head": [0, 0] },
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

const idleText = `{ "animations": [{ "name": "idle" }] }\n--- idle\nAB\n`;
const nonIdleText = `{ "animations": [{ "name": "x" }] }\n--- x\nAB\n`;

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

test('validateSpriteSet: dangling weapon/monster/npc catalog references are errors', () => {
	const diags = validateSpriteSet([]);
	const errs = diags.filter((d) => d.severity === 'error');
	const referenced = new Set([
		...WEAPONS.map((weapon) => weapon.sprite),
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
