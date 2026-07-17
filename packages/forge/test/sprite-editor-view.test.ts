import { describe, expect, test } from 'bun:test';
import { HUES, SCENE_PALETTE } from '@mmo/core/entities';
import { RARITY_COLOR } from '@mmo/core/items';
import {
	ACCENT_CYCLE,
	bitName,
	composeStatusLine,
	DEFAULT_ZOOM,
	dirForRole,
	docDynamicUsage,
	PLAYER_HUE_CYCLE,
	parseEditArg,
	pixelToScreen,
	quadrantMarker,
	resolveColorKey,
	roleForDir,
	SPRITE_PREVIEWS,
	saveDiagSummary,
	screenToPixel,
	scrollAxis,
	scrollViewport,
	spriteStatusLine,
	stepZoom,
	variantAt,
	variantPreviews,
	variantStripModel,
	visiblePixels,
	ZOOM_LADDER,
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

describe('fatbits zoom ladder', () => {
	test('the ladder is ×1/×2/×3/×4/×6 and defaults to ×2', () => {
		expect([...ZOOM_LADDER]).toEqual([1, 2, 3, 4, 6]);
		expect(DEFAULT_ZOOM).toBe(2);
	});

	test('stepZoom walks the ladder and clamps at the ends', () => {
		expect(stepZoom(2, 1)).toBe(3);
		expect(stepZoom(2, -1)).toBe(1);
		expect(stepZoom(1, -1)).toBe(1); // clamps at the bottom
		expect(stepZoom(6, 1)).toBe(6); // clamps at the top
		expect(stepZoom(4, 1)).toBe(6); // ×4 → ×6 (skips ×5, not on the ladder)
	});

	test('stepZoom snaps an off-ladder value onto the ladder first', () => {
		// ×5 snaps to its nearest rung (×4) then steps from there.
		expect(stepZoom(5, 1)).toBe(6);
		expect(stepZoom(5, -1)).toBe(3);
	});
});

describe('fatbits screen ⇄ pixel geometry', () => {
	test('each Pixel occupies zoom×zoom cells; screenToPixel is the inverse', () => {
		const cam = { x: 0, y: 0 };
		// At ×3, canvas cells 0..2 all map to Pixel 0, 3..5 to Pixel 1.
		expect(screenToPixel(0, 0, cam, 3)).toEqual({ x: 0, y: 0 });
		expect(screenToPixel(2, 2, cam, 3)).toEqual({ x: 0, y: 0 });
		expect(screenToPixel(3, 6, cam, 3)).toEqual({ x: 1, y: 2 });
	});

	test('the camera offsets in Pixel units', () => {
		const cam = { x: 4, y: 2 };
		expect(screenToPixel(0, 0, cam, 2)).toEqual({ x: 4, y: 2 });
		expect(pixelToScreen(4, 2, cam, 2)).toEqual({ x: 0, y: 0 });
		expect(pixelToScreen(6, 3, cam, 2)).toEqual({ x: 4, y: 2 });
	});

	test('pixelToScreen ∘ screenToPixel lands on the block top-left', () => {
		const cam = { x: 1, y: 1 };
		const px = screenToPixel(5, 7, cam, 2);
		const back = pixelToScreen(px.x, px.y, cam, 2);
		// The Pixel's top-left cell is within its own z×z block of cell (5,7).
		expect(back.x).toBeLessThanOrEqual(5);
		expect(back.y).toBeLessThanOrEqual(7);
		expect(back.x + 2).toBeGreaterThan(5);
		expect(back.y + 2).toBeGreaterThan(7);
	});

	test('visiblePixels floors the canvas span into whole Pixels', () => {
		expect(visiblePixels(20, 2)).toBe(10);
		expect(visiblePixels(21, 4)).toBe(5);
		expect(visiblePixels(1, 4)).toBe(1); // always at least one
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
	test('status line surfaces id, role, frame, tool, zoom, ink, coords', () => {
		const line = spriteStatusLine({
			id: 'buddy',
			role: 'form',
			frame: 'idle',
			frameIdx: 0,
			frameCount: 3,
			tool: 'paint',
			ink: 'p',
			pixel: { x: 5, y: 3 },
			cell: { x: 2, y: 1 },
			bit: 3,
			zoom: 2,
			dirty: true,
		});
		expect(line).toContain('buddy');
		expect(line).toContain('(form)');
		expect(line).toContain('idle');
		expect(line).toContain('[1/3]');
		expect(line).toContain('paint');
		expect(line).toContain('×2');
		expect(line).toContain('ink p');
		expect(line).toContain('px (5,3)');
		expect(line).toContain('cell (2,1)');
		expect(line).toContain('BR');
		// The save state ('*' when dirty) rides on the same line.
		expect(line).toContain('*');
	});

	test('composeStatusLine right-aligns the coercion feedback', () => {
		const line = composeStatusLine('left', 'punched bg', 20);
		expect(line.length).toBe(20);
		expect(line.startsWith('left')).toBe(true);
		expect(line.endsWith('punched bg')).toBe(true);
	});

	test('composeStatusLine drops the feedback when it cannot fit', () => {
		const line = composeStatusLine('a very long left side', 'note', 12);
		expect(line).toBe('a very long ');
		expect(line).not.toContain('note');
	});

	test('composeStatusLine with no feedback is just the left, clipped', () => {
		expect(composeStatusLine('hello', '', 3)).toBe('hel');
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

describe('dynamic p/a variants (spec #401, amended: session-selected, no clock)', () => {
	test('the p/a cycles are the real core palettes', () => {
		expect(PLAYER_HUE_CYCLE).toEqual(HUES);
		expect(ACCENT_CYCLE).toEqual(Object.values(RARITY_COLOR));
	});

	test('variant (0,0) is the canonical representative', () => {
		const v = variantPreviews(0, 0);
		expect(v.p).toEqual(HUES[0]);
		expect(v.a).toEqual(Object.values(RARITY_COLOR)[0]);
		// The player-hue channel also matches the static representative preview.
		expect(v.p).toEqual(SPRITE_PREVIEWS.p);
	});

	test('each channel indexes its own palette independently and wraps', () => {
		const accents = Object.values(RARITY_COLOR);
		expect(variantPreviews(3, 1).p).toEqual(HUES[3]);
		expect(variantPreviews(3, 1).a).toEqual(accents[1]);
		expect(variantPreviews(HUES.length, accents.length).p).toEqual(HUES[0]);
		expect(variantPreviews(-1, -1).p).toEqual(HUES[HUES.length - 1]);
	});
});

describe('variant strip — session hue/accent selector (spec #401 amendment)', () => {
	function docWith(
		colors: string,
		bg = '  ',
	): Parameters<typeof docDynamicUsage>[0] {
		return {
			id: 't',
			key: 'g',
			baseline: 0,
			anchors: {},
			poses: {},
			fps: {},
			colors: {},
			frames: [
				{ name: 'idle', rows: ['▘▘'], colors: [colors], bg: [bg], anchors: {} },
			],
		} as unknown as Parameters<typeof docDynamicUsage>[0];
	}

	test('usage scans fg and bg grids for the dynamic keys', () => {
		expect(docDynamicUsage(docWith('gg'))).toEqual({ p: false, a: false });
		expect(docDynamicUsage(docWith('pg'))).toEqual({ p: true, a: false });
		expect(docDynamicUsage(docWith('ga'))).toEqual({ p: false, a: true });
		expect(docDynamicUsage(docWith('gg', 'a·'))).toEqual({
			p: false,
			a: true,
		});
	});

	test('a SENTINEL fg counts as the doc default key', () => {
		const doc = docWith('··');
		(doc as { key: string }).key = 'p';
		expect(docDynamicUsage(doc)).toEqual({ p: true, a: false });
	});

	test('no dynamic usage → no strip; p-only shows only the hue swatches', () => {
		expect(
			variantStripModel({ p: false, a: false }, { p: 0, a: 0 }),
		).toBeNull();
		const pOnly = variantStripModel({ p: true, a: false }, { p: 0, a: 0 });
		expect(pOnly).not.toBeNull();
		expect(pOnly?.swatches.every((s) => s.channel === 'p')).toBe(true);
		expect(pOnly?.swatches.length).toBe(HUES.length);
	});

	test('the full strip lists 8 hue then 5 accent swatches with the active marked', () => {
		const strip = variantStripModel({ p: true, a: true }, { p: 2, a: 1 });
		if (!strip) throw new Error('expected a strip');
		const ps = strip.swatches.filter((s) => s.channel === 'p');
		const as = strip.swatches.filter((s) => s.channel === 'a');
		expect(ps.length).toBe(HUES.length); // 8
		expect(as.length).toBe(Object.values(RARITY_COLOR).length); // 5
		expect(ps[2].active).toBe(true);
		expect(ps.filter((s) => s.active).length).toBe(1);
		expect(as[1].active).toBe(true);
		expect(ps[2].rgba).toEqual(HUES[2]);
		// Swatches are laid out left→right without overlap.
		for (let i = 1; i < strip.swatches.length; i++)
			expect(strip.swatches[i].x0).toBeGreaterThanOrEqual(
				strip.swatches[i - 1].x1,
			);
	});

	test('variantAt resolves a strip column to its swatch (and misses to undefined)', () => {
		const strip = variantStripModel({ p: true, a: true }, { p: 0, a: 0 });
		if (!strip) throw new Error('expected a strip');
		const target = strip.swatches[3];
		expect(variantAt(strip, target.x0)).toBe(target);
		expect(variantAt(strip, target.x1 - 1)).toBe(target);
		expect(variantAt(strip, strip.width + 5)).toBeUndefined();
	});
});
