// Thin chrome smoke tests for the Sprite editor TUI. Logic is covered
// headlessly in sprite-editor-state/view/input tests; these only assert the
// fatbits Renderable draws the right thing and that both devices (keyboard and
// mouse) reach the pure paint ops through the normalized seam.
//
// The fatbits canvas paints each Pixel as a z×z block of colour (a space cell
// whose *background* is the ink), so painted art is invisible to
// `captureCharFrame` (which sees glyphs only). We assert it through
// `captureSpans`, which carries each cell's background colour.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENE_PALETTE } from '@mmo/core';
import { parseSpriteFile } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { readPixel } from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';
import { resolveColorKey, SPRITE_PREVIEWS } from '../src/sprite-editor/view';

const key = (name: string, extra: Partial<SpriteKey> = {}): SpriteKey => ({
	name,
	sequence: extra.sequence ?? '',
	...extra,
});

// The default-ink ('p') block colour the empty templates paint with.
const INK_P: [number, number, number] = [
	SPRITE_PREVIEWS.p[0],
	SPRITE_PREVIEWS.p[1],
	SPRITE_PREVIEWS.p[2],
];

// Whether any cell in the top `rowMax` rows (the canvas region, above the
// 3-row chrome) has a background matching `[r,g,b]` — i.e. a painted Pixel.
function canvasHasBg(
	cap: ReturnType<
		Awaited<ReturnType<typeof createTestRenderer>>['captureSpans']
	>,
	rgb: [number, number, number],
	rowMax: number,
): boolean {
	for (let y = 0; y < Math.min(rowMax, cap.lines.length); y++) {
		for (const s of cap.lines[y].spans) {
			const [r, g, b] = s.bg.toInts();
			if (r === rgb[0] && g === rgb[1] && b === rgb[2]) return true;
		}
	}
	return false;
}

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'forge-sprite-edit-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function mount(opts: {
	doc: ReturnType<typeof emptySpriteDoc>;
	id: string;
	role: 'form' | 'weapon' | 'hat' | 'monster' | 'npc';
	save?: (t: string) => void;
	width?: number;
	height?: number;
}) {
	const t = await createTestRenderer({
		width: opts.width ?? 100,
		height: opts.height ?? 20,
	});
	const editor = new SpriteEditor(t.renderer, {
		id: opts.id,
		role: opts.role,
		doc: opts.doc,
		save: opts.save ?? (() => {}),
	});
	editor.attach(t.renderer.root);
	await t.renderOnce();
	return { ...t, editor };
}

describe('Sprite editor TUI smoke', () => {
	test('opens an existing sprite and renders its frame art as a colour block', async () => {
		// A tiny hat with one lit quadrant (▘) in the idle frame.
		const text = '--- idle\n▘·\n··\n';
		const { doc } = parseSpriteFile(text, 'cap');
		if (!doc) throw new Error('fixture failed to parse');
		const { captureCharFrame, captureSpans, editor } = await mount({
			doc,
			id: 'cap',
			role: 'hat',
		});
		// Chrome carries the id + role.
		const chars = captureCharFrame();
		expect(chars).toContain('cap');
		expect(chars).toContain('(hat)');
		// The lit Pixel is a colour block on the canvas, in the frame's fg colour.
		const fg = resolveColorKey(
			doc.key,
			doc.colors,
			SCENE_PALETTE,
			SPRITE_PREVIEWS,
		);
		if (!fg) throw new Error('fixture fg did not resolve');
		expect(canvasHasBg(captureSpans(), [fg[0], fg[1], fg[2]], 17)).toBe(true);
		expect(editor.state.frame).toBe('idle');
	});

	test('opens a missing id from its role template', async () => {
		const { captureCharFrame, editor } = await mount({
			doc: emptySpriteDoc('newhat', 'hat'),
			id: 'newhat',
			role: 'hat',
		});
		const frame = captureCharFrame();
		expect(frame).toContain('newhat');
		expect(editor.state.frame).toBe('idle');
		// Help line is present.
		expect(frame).toContain('undo');
	});

	test('a keyboard pen stroke lights a Pixel block on the canvas', async () => {
		const t = await mount({
			doc: emptySpriteDoc('draw', 'hat'),
			id: 'draw',
			role: 'hat',
		});
		// Nothing is painted yet.
		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(false);
		// Paint all four quadrants of cell (0,0) as one pen stroke.
		t.editor.key(key('space')); // pen down, TL
		t.editor.key(key('right')); // TR
		t.editor.key(key('down')); // BR
		t.editor.key(key('left')); // BL
		t.editor.key(key('space')); // lift pen
		await t.renderOnce();
		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(true);
		// The whole drag coalesced into a single undo step.
		expect(t.editor.state.history.past.length).toBe(1);
	});

	test('the status line shows the zoom and Pixel/cell coordinates', async () => {
		const t = await mount({
			doc: emptySpriteDoc('coords', 'hat'),
			id: 'coords',
			role: 'hat',
		});
		t.editor.key(key('right')); // cursor → pixel (1,0)
		await t.renderOnce();
		const frame = t.captureCharFrame();
		expect(frame).toContain('×2'); // default zoom
		expect(frame).toContain('px (1,0)');
		expect(frame).toContain('cell (0,0)');
	});

	test('+ / - step the zoom ladder', async () => {
		const t = await mount({
			doc: emptySpriteDoc('zoomy', 'hat'),
			id: 'zoomy',
			role: 'hat',
		});
		expect(t.editor.zoom).toBe(2);
		t.editor.key(key('+', { sequence: '+' }));
		expect(t.editor.zoom).toBe(3);
		t.editor.key(key('-', { sequence: '-' }));
		t.editor.key(key('-', { sequence: '-' }));
		expect(t.editor.zoom).toBe(1);
		t.editor.key(key('-', { sequence: '-' })); // clamps at the bottom
		expect(t.editor.zoom).toBe(1);
	});

	test('a coercing paint surfaces its feedback right-aligned on the status line', async () => {
		// A wide terminal so the right-aligned coercion note has room to show.
		const t = await mount({
			doc: emptySpriteDoc('bad', 'hat'),
			id: 'bad',
			role: 'hat',
			width: 140,
		});
		t.editor.key(key('space')); // paint 'p' at TL
		t.editor.key(key('space')); // lift pen
		// Switch ink to a different key via the picker.
		t.editor.key(key('f'));
		t.editor.key(key('down'));
		t.editor.key(key('enter'));
		expect(t.editor.picker).toBeNull();
		t.editor.key(key('right')); // move to TR of the same cell
		t.editor.key(key('space')); // overpaint a second colour → coerces, never refuses
		await t.renderOnce();
		// The paint succeeded and reported the coercion it made.
		expect(t.editor.state.feedback).not.toBe('');
		expect(t.captureCharFrame()).toContain(t.editor.state.feedback);
	});

	test('save writes the .sprite file and shows diagnostics inline', async () => {
		const savePath = join(root, 'hats', 'saveme.sprite');
		mkdirSync(join(root, 'hats'), { recursive: true });
		const t = await mount({
			doc: emptySpriteDoc('saveme', 'hat'),
			id: 'saveme',
			role: 'hat',
			save: (text) => writeFileSync(savePath, text),
		});
		t.editor.key(key('space')); // paint something
		t.editor.key(key('w')); // save
		await t.renderOnce();
		expect(existsSync(savePath)).toBe(true);
		expect(readFileSync(savePath, 'utf8')).toContain('--- idle');
		// The inline save summary is shown.
		expect(t.captureCharFrame().toLowerCase()).toContain('saved');
	});

	test('the color picker opens and lists the dynamic channels by meaning', async () => {
		const t = await mount({
			doc: emptySpriteDoc('pick', 'hat'),
			id: 'pick',
			role: 'hat',
		});
		t.editor.key(key('f'));
		await t.renderOnce();
		expect(t.editor.picker).not.toBeNull();
		const frame = t.captureCharFrame();
		expect(frame).toContain('player hue');
		expect(frame).toContain('weapon accent');
	});
});

describe('Sprite editor mouse painting', () => {
	// A left click-drag paints the active ink; screen cells resolve to Pixels
	// through the fatbits geometry (×2 default: 2×2 cells per Pixel).
	test('a left click-drag paints Pixels and coalesces into one undo step', async () => {
		const t = await mount({
			doc: emptySpriteDoc('m', 'hat'),
			id: 'm',
			role: 'hat',
		});
		// Down at screen (0,0) → Pixel (0,0); drag to screen (2,0) → Pixel (1,0).
		t.editor.mouseDown({ button: 0, x: 0, y: 0 });
		t.editor.mouseDrag({ button: 0, x: 2, y: 0 });
		t.editor.mouseUp();
		// Both touched Pixels are lit.
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		expect(readPixel(t.editor.state, 1, 0)).toBe(true);
		// One stroke → one undo step.
		expect(t.editor.state.history.past.length).toBe(1);
	});

	test('a drag keeps painting even when it does not re-report the button', async () => {
		const t = await mount({
			doc: emptySpriteDoc('drag', 'hat'),
			id: 'drag',
			role: 'hat',
		});
		// Some terminals report drags with button 'none' (button code > 2); the
		// stroke's button is remembered from mouseDown so inking continues.
		t.editor.mouseDown({ button: 0, x: 0, y: 0 });
		t.editor.mouseDrag({ button: 99, x: 2, y: 2 });
		t.editor.mouseUp();
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		expect(readPixel(t.editor.state, 1, 1)).toBe(true);
	});

	test('the right button paints transparent ink (erases)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('erase', 'hat'),
			id: 'erase',
			role: 'hat',
		});
		t.editor.mouseDown({ button: 0, x: 0, y: 0 });
		t.editor.mouseUp();
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		// Right-click the same Pixel: transparent ink clears it.
		t.editor.mouseDown({ button: 2, x: 0, y: 0 });
		t.editor.mouseUp();
		expect(readPixel(t.editor.state, 0, 0)).toBe(false);
	});

	test('zoom changes the screen→Pixel mapping', async () => {
		const t = await mount({
			doc: emptySpriteDoc('z', 'hat'),
			id: 'z',
			role: 'hat',
		});
		t.editor.zoom = 4;
		await t.renderOnce(); // capture geometry at the new zoom
		// At ×4, screen cells 0..3 all map to Pixel 0.
		t.editor.mouseDown({ button: 0, x: 3, y: 3 });
		t.editor.mouseUp();
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		expect(readPixel(t.editor.state, 1, 1)).toBe(false);
	});

	test('a click outside the canvas region paints nothing', async () => {
		const t = await mount({
			doc: emptySpriteDoc('oob', 'hat'),
			id: 'oob',
			role: 'hat',
		});
		const before = t.editor.state.doc;
		// Row 17 is the status chrome, not canvas.
		t.editor.mouseDown({ button: 0, x: 0, y: 17 });
		t.editor.mouseUp();
		expect(t.editor.state.doc).toBe(before);
	});
});
