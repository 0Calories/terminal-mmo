import { describe, expect, test } from 'bun:test';
import { SCENE_PALETTE } from '@mmo/core';
import {
	bitName,
	dirForRole,
	parseEditArg,
	quadrantMarker,
	resolveColorKey,
	roleForDir,
	SPRITE_KEY_HINTS,
	SPRITE_PREVIEWS,
	saveDiagSummary,
	scrollAxis,
	scrollViewport,
	spriteHelpLine,
	spriteStatusLine,
} from '../src/sprite-editor/view';

describe('role ⇄ directory mapping', () => {
	test('every role maps to a directory and back', () => {
		for (const role of ['form', 'weapon', 'hat', 'monster', 'npc'] as const)
			expect(roleForDir(dirForRole(role))).toBe(role);
	});

	test('directory names resolve to roles', () => {
		expect(roleForDir('forms')).toBe('form');
		expect(roleForDir('weapons')).toBe('weapon');
		expect(roleForDir('hats')).toBe('hat');
		expect(roleForDir('monsters')).toBe('monster');
		expect(roleForDir('npcs')).toBe('npc');
		expect(roleForDir('bogus')).toBeUndefined();
	});
});

describe('parseEditArg', () => {
	test('a role-prefixed id yields id + role', () => {
		expect(parseEditArg('forms/buddy')).toEqual({ id: 'buddy', role: 'form' });
		expect(parseEditArg('hats/cap.sprite')).toEqual({ id: 'cap', role: 'hat' });
	});

	test('a nested path takes the last dir segment as the role', () => {
		expect(parseEditArg('sprites/weapons/sword')).toEqual({
			id: 'sword',
			role: 'weapon',
		});
	});

	test('a bare id has no role', () => {
		expect(parseEditArg('buddy')).toEqual({ id: 'buddy' });
	});

	test('an unknown role dir yields no role', () => {
		expect(parseEditArg('junk/thing')).toEqual({ id: 'thing' });
	});

	test('empty arg is undefined', () => {
		expect(parseEditArg('')).toBeUndefined();
	});
});

describe('resolveColorKey', () => {
	const local = { q: [10, 20, 30, 255] as const };
	test('transparent for empty', () => {
		expect(
			resolveColorKey('', local, SCENE_PALETTE, SPRITE_PREVIEWS),
		).toBeNull();
		expect(
			resolveColorKey(' ', local, SCENE_PALETTE, SPRITE_PREVIEWS),
		).toBeNull();
	});
	test('dynamic keys resolve to preview colors', () => {
		expect(resolveColorKey('p', local, SCENE_PALETTE, SPRITE_PREVIEWS)).toEqual(
			SPRITE_PREVIEWS.p,
		);
		expect(resolveColorKey('a', local, SCENE_PALETTE, SPRITE_PREVIEWS)).toEqual(
			SPRITE_PREVIEWS.a,
		);
	});
	test('local wins over global', () => {
		expect(resolveColorKey('q', local, SCENE_PALETTE, SPRITE_PREVIEWS)).toEqual(
			[10, 20, 30, 255],
		);
	});
	test('global palette resolves', () => {
		expect(resolveColorKey('g', local, SCENE_PALETTE, SPRITE_PREVIEWS)).toEqual(
			SCENE_PALETTE.g,
		);
	});
	test('unknown key is null', () => {
		expect(
			resolveColorKey('Z', local, SCENE_PALETTE, SPRITE_PREVIEWS),
		).toBeNull();
	});
});

describe('viewport scrolling', () => {
	test('scrollAxis keeps the cursor within the viewport', () => {
		expect(scrollAxis(0, 0, 10, 2)).toBe(0);
		// Cursor beyond the right edge scrolls to keep the scrolloff margin.
		expect(scrollAxis(0, 20, 10, 2)).toBe(13);
		// Never negative.
		expect(scrollAxis(5, 0, 10, 2)).toBe(0);
	});
	test('scrollViewport scrolls both axes', () => {
		const cam = scrollViewport({ x: 0, y: 0 }, { x: 30, y: 20 }, 10, 8, 2);
		expect(cam.x).toBeGreaterThan(0);
		expect(cam.y).toBeGreaterThan(0);
	});
});

describe('quadrant markers', () => {
	test('each bit gets a distinct corner block', () => {
		expect(quadrantMarker(0)).toBe('▘');
		expect(quadrantMarker(1)).toBe('▝');
		expect(quadrantMarker(2)).toBe('▖');
		expect(quadrantMarker(3)).toBe('▗');
	});
	test('bit names', () => {
		expect(bitName(0)).toBe('TL');
		expect(bitName(3)).toBe('BR');
	});
});

describe('status + help chrome', () => {
	test('status line surfaces id, role, frame, tool, ink, cursor', () => {
		const line = spriteStatusLine({
			id: 'buddy',
			role: 'form',
			frame: 'idle',
			frameIdx: 0,
			frameCount: 3,
			tool: 'paint',
			ink: 'p',
			cell: { x: 2, y: 1 },
			bit: 3,
			dirty: true,
		});
		expect(line).toContain('buddy');
		expect(line).toContain('(form)');
		expect(line).toContain('idle');
		expect(line).toContain('[1/3]');
		expect(line).toContain('paint');
		expect(line).toContain('ink p');
		expect(line).toContain('(2,1)');
		expect(line).toContain('BR');
		expect(line).toContain('*');
	});

	test('help line lists every hint', () => {
		const help = spriteHelpLine();
		for (const h of SPRITE_KEY_HINTS) expect(help).toContain(h.keys);
	});

	test('save diag summary — clean and dirty', () => {
		expect(saveDiagSummary([])).toContain('no issues');
		const s = saveDiagSummary([
			{ severity: 'error', message: 'boom' },
			{ severity: 'warning', message: 'meh' },
		]);
		expect(s).toContain('1 error');
		expect(s).toContain('1 warning');
		expect(s).toContain('boom');
	});
});
