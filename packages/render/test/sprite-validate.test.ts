// Role-profile validator (ADR 0031): pure functions over parsed SpriteDocs and
// in-memory SpriteSource sets. No disk access.
import { expect, test } from 'bun:test';
import type { SpriteSource } from '@mmo/assets';
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
	"animations": { "walkA": ["wa"], "walkB": ["wb"] }
}
--- idle
AB
CD
--- wa
AB
CD
--- wb
AB
CD
`;

test('validateSpriteRole: forms passes with idle/walkA/walkB and grip/head', () => {
	expect(validateSpriteRole(docOf(FORMS_OK, 'buddy'), 'forms')).toEqual([]);
});

const FORMS_BAD = `{
	"anchors": { "grip": [1, 0] }
}
--- idle
AB
CD
--- walkA
AB
CD
`;

test('validateSpriteRole: forms fails naming missing animation and anchor', () => {
	const diags = validateSpriteRole(docOf(FORMS_BAD, 'buddy'), 'forms');
	expect(diags.every((d) => d.severity === 'error')).toBe(true);
	expect(diags.every((d) => d.spriteId === 'buddy')).toBe(true);
	const joined = diags.map((d) => d.message).join('\n');
	expect(joined).toContain('walkB');
	expect(joined).toContain('head');
	expect(joined).toContain('buddy');
	expect(joined).toContain('forms');
	// grip and walkA are present, so must not be reported
	expect(joined).not.toContain('walkA');
});

const FORMS_KNOWN_EMOTE = `{
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": { "walkA": ["wa"], "walkB": ["wb"], "emote:wave": ["ev"] }
}
--- idle
AB
--- wa
AB
--- wb
AB
--- ev
AB
`;

test('validateSpriteRole: forms accepts an emote animation for a registered emote', () => {
	expect(
		validateSpriteRole(docOf(FORMS_KNOWN_EMOTE, 'buddy'), 'forms'),
	).toEqual([]);
});

const FORMS_UNKNOWN_EMOTE = `{
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": { "walkA": ["wa"], "walkB": ["wb"], "emote:boogie": ["bg"] }
}
--- idle
AB
--- wa
AB
--- wb
AB
--- bg
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

const WEAPON_OK = `{
	"anchors": { "grip": [0, 0] },
	"animations": { "windup": ["wu"], "active": ["ac"] }
}
--- idle
AB
--- wu
AB
--- ac
AB
`;

test('validateSpriteRole: weapons passes with idle/windup/active and grip (recovery optional)', () => {
	expect(validateSpriteRole(docOf(WEAPON_OK, 'sword'), 'weapons')).toEqual([]);
});

const WEAPON_BAD = `{
	"animations": { "windup": ["wu"] }
}
--- idle
AB
--- wu
AB
`;

test('validateSpriteRole: weapons fails on missing active animation and grip anchor', () => {
	const diags = validateSpriteRole(docOf(WEAPON_BAD, 'sword'), 'weapons');
	expect(diags.length).toBe(2);
	const joined = diags.map((d) => d.message).join('\n');
	expect(joined).toContain('active');
	expect(joined).toContain('grip');
});

test('validateSpriteRole: hats/monsters/npcs require only idle', () => {
	const okText = `--- idle\nAB\n`;
	const badText = `--- x\nAB\n`;
	for (const role of ['hats', 'monsters', 'npcs']) {
		expect(validateSpriteRole(docOf(okText, 'h'), role)).toEqual([]);
		const bad = validateSpriteRole(docOf(badText, 'h'), role);
		expect(bad.length).toBe(1);
		expect(bad[0].severity).toBe('error');
		expect(bad[0].message).toContain('idle');
	}
});

test('validateSpriteRole: unknown role is a warning', () => {
	const diags = validateSpriteRole(docOf(`--- idle\nAB\n`, 'x'), 'bogus');
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
		{ id: 'good-hat', role: 'hats', text: `--- idle\nAB\n` },
		{ id: 'bad-hat', role: 'hats', text: `--- x\nAB\n` },
		{ id: 'broken', role: 'hats', text: 'not valid json {{{' },
	];
	const diags = validateSpriteSet(sources);
	// broken: at least one parse diagnostic; bad-hat: one role diagnostic; good-hat: none
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
	// Scope to the broken sprite: whole-set reference checks add their own
	// (dangling catalog) diagnostics with other ids, which are unrelated here.
	const brokenDiags = diags.filter((d) => d.spriteId === 'broken');
	expect(brokenDiags.length).toBeGreaterThan(0);
	// only the parse diagnostic(s) — no "missing animation"/"missing anchor" profile noise
	expect(brokenDiags.some((d) => d.message.includes('missing'))).toBe(false);
});

// A minimal valid weapon source (idle/windup/active + grip) for reference tests.
function weaponSource(id: string): SpriteSource {
	return {
		id,
		role: 'weapons',
		text: `{"anchors":{"grip":[0,0]},"animations":{"windup":["wu"],"active":["ac"]}}
--- idle
AB
--- wu
AB
--- ac
AB
`,
	};
}

function idleSource(id: string, role: string): SpriteSource {
	return { id, role, text: `--- idle\nAB\n` };
}

test('validateSpriteSet: dangling weapon/monster/npc catalog references are errors', () => {
	// An empty set: every id the @mmo/core catalogs/refs expect dangles.
	const diags = validateSpriteSet([]);
	const errs = diags.filter((d) => d.severity === 'error');
	const byId = (id: string) => errs.find((d) => d.spriteId === id);
	// 'sword' (WEAPONS[].sprite), 'chaser' (MONSTER_SPRITE_REF), 'merchant'
	// (NPC_SPRITE_REF.vendor) are stable references the game expects.
	expect(byId('sword')).toBeDefined();
	expect(byId('chaser')).toBeDefined();
	expect(byId('merchant')).toBeDefined();
	// Diagnostics say what is wrong (the id) and why it matters.
	expect(byId('sword')?.message).toContain('sword');
	expect(byId('chaser')?.message).toContain('chaser');
});

test('validateSpriteSet: resolved catalog references produce no dangling-reference error', () => {
	const sources: SpriteSource[] = [
		weaponSource('sword'),
		idleSource('chaser', 'monsters'),
		idleSource('shooter', 'monsters'),
		idleSource('brute', 'monsters'),
		idleSource('merchant', 'npcs'),
		idleSource('unused-npc', 'npcs'),
	];
	const diags = validateSpriteSet(sources);
	// The dangling-reference diagnostic message contains the word "resolves".
	expect(diags.some((d) => d.message.includes('resolves'))).toBe(false);
});

test('validateSpriteSet: an unresolvable color key is an error, not a silent fallback', () => {
	// 'q' is file-local; 'z' is neither file-local, reserved, nor in SCENE_PALETTE.
	const src: SpriteSource = {
		id: 'badcol',
		role: 'hats',
		text: `{"colors":{"q":[1,2,3,255]}}\n--- idle\nAB\n@colors\nqz\n`,
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
	// Surfaced as an error, not left as a mere warning (silent default fallback).
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
		text: `{"colors":{"p":[1,2,3,255]}}\n--- idle\nAB\n`,
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
