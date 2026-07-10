// Role-profile validator (ADR 0031): pure functions over parsed SpriteDocs and
// in-memory SpriteSource sets. No disk access.
import { expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc } from '../src';
import type { SpriteSource } from '../src/sprite-sources';
import { validateSpriteRole, validateSpriteSet } from '../src/sprite-validate';

function docOf(text: string, id = 's'): SpriteDoc {
	const { doc, diagnostics } = parseSpriteFile(text, id);
	if (doc === null)
		throw new Error(`parse failed: ${JSON.stringify(diagnostics)}`);
	return doc;
}

const FORMS_OK = `{
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"poses": { "walkA": ["wa"], "walkB": ["wb"] }
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

test('validateSpriteRole: forms fails naming missing pose and anchor', () => {
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

const WEAPON_OK = `{
	"anchors": { "grip": [0, 0] },
	"poses": { "windup": ["wu"], "active": ["ac"] }
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
	"poses": { "windup": ["wu"] }
}
--- idle
AB
--- wu
AB
`;

test('validateSpriteRole: weapons fails on missing active pose and grip anchor', () => {
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
	// only the parse diagnostic(s) — no "missing pose"/"missing anchor" profile noise
	expect(diags.every((d) => d.spriteId === 'broken')).toBe(true);
	expect(diags.some((d) => d.message.includes('missing'))).toBe(false);
});
