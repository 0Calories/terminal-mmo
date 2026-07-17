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
import { HUES, SCENE_PALETTE, STANDARD_PALETTE } from '@mmo/core/entities';
import { parseSpriteFile } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { RAIL_W, railModel } from '../src/sprite-editor/chrome';
import {
	currentFrame,
	frameExtent,
	paletteEntries,
	readPixel,
} from '../src/sprite-editor/state';
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

// Whether any cell in the top `rowMax` rows of the CANVAS REGION (right of the
// 30-column rail, above the chrome) has a background matching `[r,g,b]` — i.e.
// a painted Pixel. The rail is skipped because its ink swatches carry the same
// colours as painted art.
function canvasHasBg(
	cap: ReturnType<
		Awaited<ReturnType<typeof createTestRenderer>>['captureSpans']
	>,
	rgb: [number, number, number],
	rowMax: number,
): boolean {
	for (let y = 0; y < Math.min(rowMax, cap.lines.length); y++) {
		let col = 0;
		for (const s of cap.lines[y].spans) {
			const [r, g, b] = s.bg.toInts();
			if (
				col + s.width > RAIL_W &&
				r === rgb[0] &&
				g === rgb[1] &&
				b === rgb[2]
			)
				return true;
			col += s.width;
		}
	}
	return false;
}

// The smallest canvas-region screen column (right of the rail) whose background
// matches `rgb`, or -1 when the colour is absent. Used to prove the float's art
// tracks its offset across the canvas.
function minInkColumn(
	cap: ReturnType<
		Awaited<ReturnType<typeof createTestRenderer>>['captureSpans']
	>,
	rgb: [number, number, number],
	rowMax: number,
): number {
	let min = -1;
	for (let y = 0; y < Math.min(rowMax, cap.lines.length); y++) {
		let col = 0;
		for (const s of cap.lines[y].spans) {
			const [r, g, b] = s.bg.toInts();
			if (col >= RAIL_W && r === rgb[0] && g === rgb[1] && b === rgb[2])
				if (min < 0 || col < min) min = col;
			col += s.width;
		}
	}
	return min;
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
	initialFeedback?: string;
}) {
	const t = await createTestRenderer({
		width: opts.width ?? 100,
		// The ≥80×24 floor (#398): mount at the floor by default so the editor UI
		// renders (below it a placard replaces the whole UI).
		height: opts.height ?? 24,
	});
	const editor = new SpriteEditor(t.renderer, {
		id: opts.id,
		role: opts.role,
		doc: opts.doc,
		save: opts.save ?? (() => {}),
		initialFeedback: opts.initialFeedback,
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

	test('a fresh-template open surfaces its initial feedback in the status line', async () => {
		// The CLI passes "creating new sprite …" when no existing file resolved, so
		// a failed load can never silently masquerade as a fresh file.
		const t = await mount({
			doc: emptySpriteDoc('newhat', 'hat'),
			id: 'newhat',
			role: 'hat',
			initialFeedback: 'creating new sprite hats/newhat',
			// Wide enough for the status row's right-aligned feedback slot to fit
			// next to the full left status content (narrow widths drop the note by
			// composeStatusLine's left-wins rule, covered in sprite-editor-view).
			width: 140,
		});
		expect(t.editor.state.feedback).toBe('creating new sprite hats/newhat');
		expect(t.captureCharFrame()).toContain('creating new sprite hats/newhat');
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

	test('a whole-Frame shift floats the art live on the canvas (spec #399)', async () => {
		// A hat with a single lit Pixel at the top-left of the idle frame.
		const { doc } = parseSpriteFile('--- idle\n▘·\n··\n', 'flo');
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'flo', role: 'hat' });
		const fg = resolveColorKey(
			doc.key,
			doc.colors,
			SCENE_PALETTE,
			SPRITE_PREVIEWS,
		);
		if (!fg) throw new Error('fixture fg did not resolve');
		const rgb: [number, number, number] = [fg[0], fg[1], fg[2]];

		const before = minInkColumn(t.captureSpans(), rgb, 17);
		expect(before).toBeGreaterThanOrEqual(0); // the art is on the canvas

		// Shift the whole Frame right three Pixels (select-all + float, spec #399).
		t.editor.key(key('right', { shift: true }));
		t.editor.key(key('right', { shift: true }));
		t.editor.key(key('right', { shift: true }));
		await t.renderOnce();

		// The TUI entered a live float, and the canvas draws the art at its offset —
		// the same composite the preview pane renders (both read floatDisplayDoc).
		expect(t.editor.state.float).not.toBeNull();
		expect(t.editor.state.float?.dx).toBe(3);
		const after = minInkColumn(t.captureSpans(), rgb, 17);
		expect(after).toBeGreaterThan(before); // the art tracked the float right
	});

	test('Enter drops a whole-Frame-shift float from the pencil tool (spec #399)', async () => {
		const { doc } = parseSpriteFile('--- idle\n▘·\n··\n', 'flo2');
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'flo2', role: 'hat' });
		// A whole-Frame shift floats under the default pencil tool.
		t.editor.key(key('down', { shift: true }));
		expect(t.editor.state.float).not.toBeNull();
		const before = t.editor.state.history.past.length;
		// Enter commits the float as one undo step, even though the pencil is active.
		t.editor.key(key('return'));
		expect(t.editor.state.float).toBeNull();
		expect(t.editor.state.history.past.length).toBe(before + 1);
		// The art moved down one Pixel (into cell (0,0)'s lower quadrant).
		expect(readPixel(t.editor.state, 0, 0)).toBe(false);
		expect(readPixel(t.editor.state, 0, 1)).toBe(true);
	});

	test('y copies and 9 pastes a float at the source through the keyboard (spec #400)', async () => {
		// A hat with a single lit Pixel at the top-left of the idle frame.
		const { doc } = parseSpriteFile('--- idle\n▘·\n··\n', 'clip');
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'clip', role: 'hat' });

		// Select the top-left Pixel (marquee via the select tool: 7).
		t.editor.key(key('7', { sequence: '7' }));
		t.editor.key(key('return')); // anchor at cursor (0,0)
		t.editor.key(key('return')); // commit a 1-Pixel selection
		expect(t.editor.state.selection).not.toBeNull();

		// Copy it (y) — a pure read, no undo entry, buffer filled.
		const beforeHist = t.editor.state.history.past.length;
		t.editor.key(key('y', { sequence: 'y' }));
		expect(t.editor.state.clipboard?.pixels).toHaveLength(1);
		expect(t.editor.state.history.past.length).toBe(beforeHist);

		// Paste (9) spawns a paste float at the source, handing off to the move tool.
		t.editor.key(key('9', { sequence: '9' }));
		expect(t.editor.state.float).not.toBeNull();
		expect(t.editor.state.tool).toBe('move');

		// Drag it right two Pixels (move-tool arrow nudge) and drop with Enter.
		t.editor.key(key('right'));
		t.editor.key(key('right'));
		t.editor.key(key('return'));
		expect(t.editor.state.float).toBeNull();
		// The original art stays (paste never lifts) and a copy landed at +2.
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		expect(readPixel(t.editor.state, 2, 0)).toBe(true);
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
		// Define a fresh file-local colour via the `e` modal; it becomes the active
		// ink, so overpainting the same cell coerces rather than being a no-op.
		t.editor.key(key('e'));
		expect(t.editor.colorPicker).not.toBeNull();
		t.editor.key(key('enter')); // commit the default colour under an auto key
		expect(t.editor.colorPicker).toBeNull();
		expect(t.editor.state.ink.kind).toBe('color');
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

	test('the e colour picker modal opens over a hue/shade grid + hex entry', async () => {
		const t = await mount({
			doc: emptySpriteDoc('def', 'hat'),
			id: 'def',
			role: 'hat',
		});
		t.editor.key(key('e'));
		await t.renderOnce();
		expect(t.editor.colorPicker).not.toBeNull();
		expect(t.editor.colorPicker?.mode).toBe('define');
		const frame = t.captureCharFrame();
		expect(frame).toContain('Define file-local colour');
		expect(frame).toContain('hex #');
	});

	test('a painted p Pixel cycles through the real player hues over time (spec #401)', async () => {
		// A hat with one lit `p` (dynamic hue) Pixel in the idle frame.
		const { doc } = parseSpriteFile('--- idle\n▘·\n··\n', 'cyc');
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'cyc', role: 'hat' });

		const hue = (i: number): [number, number, number] => [
			HUES[i][0],
			HUES[i][1],
			HUES[i][2],
		];
		// Phase 0: the Pixel renders the first player hue.
		expect(canvasHasBg(t.captureSpans(), hue(0), 6)).toBe(true);

		// Advance one cycle step; the same Pixel now renders the next hue.
		t.editor.tick(700); // one PREVIEW_CYCLE_MS step
		await t.renderOnce();
		expect(canvasHasBg(t.captureSpans(), hue(1), 6)).toBe(true);
	});
});

describe('Sprite editor mouse painting', () => {
	// In the default strips view the active frame's block sits at screen
	// (RAIL_W, 1): content row 0 is the strip's label. Screen cells resolve to
	// Pixels through the fatbits geometry (×2 default: 2×2 cells per Pixel).
	const bx = RAIL_W;
	const by = 1;

	test('a left click-drag paints Pixels and coalesces into one undo step', async () => {
		const t = await mount({
			doc: emptySpriteDoc('m', 'hat'),
			id: 'm',
			role: 'hat',
		});
		// Down at the block's origin → Pixel (0,0); drag 2 cells right → Pixel (1,0).
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseDrag({ button: 0, x: bx + 2, y: by });
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
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseDrag({ button: 99, x: bx + 2, y: by + 2 });
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
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseUp();
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		// Right-click the same Pixel: transparent ink clears it.
		t.editor.mouseDown({ button: 2, x: bx, y: by });
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
		// At ×4, the block's first 4 columns/rows all map to Pixel 0.
		t.editor.mouseDown({ button: 0, x: bx + 3, y: by + 3 });
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
		// Row 22 is the status chrome (H=24 → viewH=22), not canvas.
		t.editor.mouseDown({ button: 0, x: bx, y: 22 });
		t.editor.mouseUp();
		expect(t.editor.state.doc).toBe(before);
	});
});

describe('Sprite editor palette rail: eyedrop + crop rebind (#397)', () => {
	const bx = RAIL_W;
	const by = 1;

	test('c crops to the committed selection (the quick-pick is retired)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('crop', 'hat'),
			id: 'crop',
			role: 'hat',
		});
		const before = currentFrame(t.editor.state);
		// Marquee cells (0,0)-(1,0) with the select tool, then crop with plain c.
		t.editor.key(key('7', { sequence: '7' }));
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseDrag({ button: 0, x: bx + 3, y: by + 1 });
		t.editor.mouseUp();
		expect(t.editor.state.selection).not.toBeNull();
		t.editor.key(key('c'));
		const after = frameExtent(currentFrame(t.editor.state));
		expect(after.w).toBeLessThan(frameExtent(before).w);
	});

	test('C is unbound: shift-c neither crops nor changes state', async () => {
		const t = await mount({
			doc: emptySpriteDoc('bigc', 'hat'),
			id: 'bigc',
			role: 'hat',
		});
		const before = t.editor.state;
		t.editor.key(key('c', { sequence: 'C', shift: true }));
		expect(t.editor.state.doc).toBe(before.doc);
		expect(frameExtent(currentFrame(t.editor.state))).toEqual(
			frameExtent(currentFrame(before)),
		);
	});

	test('i eyedrops the key under the cursor, one-shot', async () => {
		const t = await mount({
			doc: emptySpriteDoc('eye', 'hat'),
			id: 'eye',
			role: 'hat',
		});
		const painted = t.editor.state.ink; // the doc's default key
		t.editor.key(key('space')); // paint at cursor (0,0)
		t.editor.key(key('space')); // lift pen
		t.editor.key(key('t')); // move the active ink away (→ transparent)
		t.editor.key(key('i')); // sample the lit Pixel at the cursor
		expect(t.editor.state.ink).toEqual(painted);
	});

	test("ink selection is mouse-only: ; and ' no longer nudge the ink", async () => {
		const t = await mount({
			doc: emptySpriteDoc('nudge', 'hat'),
			id: 'nudge',
			role: 'hat',
		});
		const before = t.editor.state.ink;
		t.editor.key(key("'", { sequence: "'" }));
		t.editor.key(key(';', { sequence: ';' }));
		expect(t.editor.state.ink).toEqual(before);
	});

	test('alt-click samples the key under the pointer without painting', async () => {
		const t = await mount({
			doc: emptySpriteDoc('alt', 'hat'),
			id: 'alt',
			role: 'hat',
		});
		const painted = t.editor.state.ink;
		t.editor.mouseDown({ button: 0, x: bx, y: by }); // paint a Pixel
		t.editor.mouseUp();
		t.editor.key(key('t')); // ink → transparent
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, x: bx, y: by, modifiers: { alt: true } });
		t.editor.mouseUp();
		expect(t.editor.state.ink).toEqual(painted); // sampled back
		expect(readPixel(t.editor.state, 0, 0)).toBe(true); // art untouched
		expect(t.editor.state.doc).toBe(before);
	});
});

describe('Sprite editor chrome (#392): rail, strips/focus, navigation, help', () => {
	// A two-frame pose: frames 'a' and 'b' side by side in one strip.
	function twoFrameDoc(): ReturnType<typeof emptySpriteDoc> {
		const frame = (name: string) => ({
			name,
			rows: ['  ', '  '],
			colors: ['  ', '  '],
			bg: ['  ', '  '],
			anchors: {},
		});
		return {
			id: 'duo',
			key: 'p',
			baseline: 0,
			anchors: {},
			poses: { idle: ['a', 'b'] },
			fps: {},
			colors: {},
			frames: [frame('a'), frame('b')],
		};
	}

	test('the left rail carries the tools row, ink list and playback box', async () => {
		// A tall terminal so the full playback box shows (rung 3 folds it when the
		// rail can't fit the full ink list + playback — e.g. at the 24-row floor).
		const t = await mount({
			doc: emptySpriteDoc('rail', 'hat'),
			id: 'rail',
			role: 'hat',
			height: 34,
		});
		const lines = t.captureCharFrame().split('\n');
		const rail = lines.map((l) => l.slice(0, RAIL_W)).join('\n');
		expect(rail).toContain('tools');
		expect(rail).toContain('pencil');
		expect(rail).toContain('ink');
		expect(rail).toContain('▚▚'); // the transparent swatch in the grid
		expect(rail).toContain('playback');
		expect(rail).toContain('pose idle');
	});

	test('strips view labels every pose and underlines the active frame', async () => {
		const t = await mount({
			doc: twoFrameDoc(),
			id: 'duo',
			role: 'hat',
		});
		const frame = t.captureCharFrame();
		expect(t.editor.view).toBe('strips');
		expect(frame).toContain('idle · 2f');
		// The active frame 'a' is underlined on the name row; 'b' is plain.
		const nameRow = frame.split('\n').find((l) => l.includes('▔'));
		expect(nameRow).toBeDefined();
		expect(nameRow).toContain('a▔');
	});

	test('clicking another frame activates it AND applies the tool (click-through)', async () => {
		const t = await mount({ doc: twoFrameDoc(), id: 'duo', role: 'hat' });
		expect(t.editor.state.frame).toBe('a');
		// Frame 'b' block: 2×2 cells → 4×4 Pixels → ×2 → 8 cols; gap 2 → x offset 10.
		t.editor.mouseDown({ button: 0, x: RAIL_W + 10, y: 1 });
		t.editor.mouseUp();
		expect(t.editor.state.frame).toBe('b');
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
	});

	test('tab toggles focus mode with a frame-name tab row', async () => {
		const t = await mount({ doc: twoFrameDoc(), id: 'duo', role: 'hat' });
		t.editor.key(key('tab'));
		await t.renderOnce();
		expect(t.editor.view).toBe('focus');
		const tabRow = t.captureCharFrame().split('\n')[0].slice(RAIL_W);
		expect(tabRow).toContain('a │ b');
		// Clicking a tab activates that frame.
		const bCol = RAIL_W + tabRow.indexOf('b', tabRow.indexOf('│'));
		t.editor.mouseDown({ button: 0, x: bCol, y: 0 });
		expect(t.editor.state.frame).toBe('b');
		t.editor.key(key('tab'));
		expect(t.editor.view).toBe('strips');
	});

	test('wheel scrolls the strips; ctrl-wheel zooms; middle-drag pans', async () => {
		const t = await mount({
			doc: emptySpriteDoc('nav', 'form'),
			id: 'nav',
			role: 'form',
		});
		// walkB's strip label sits at content row ~38 — off-screen at the 24-row
		// floor (viewH=22), below both the idle and walkA strips.
		expect(t.captureCharFrame()).not.toContain('walkB ·');
		t.editor.wheel({ button: 0, x: 40, y: 5, scroll: { direction: 'down' } });
		await t.renderOnce();
		// One notch (3 rows) brings nothing yet; keep scrolling.
		for (let i = 0; i < 5; i++)
			t.editor.wheel({ button: 0, x: 40, y: 5, scroll: { direction: 'down' } });
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('walkB ·');
		// Middle-drag pans back up.
		t.editor.mouseDown({ button: 1, x: 40, y: 2 });
		t.editor.mouseDrag({ button: 1, x: 40, y: 20 });
		t.editor.mouseUp();
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('idle ·');
		// ctrl-wheel rides the zoom ladder.
		expect(t.editor.zoom).toBe(2);
		t.editor.wheel({
			button: 0,
			x: 40,
			y: 5,
			modifiers: { ctrl: true },
			scroll: { direction: 'up' },
		});
		expect(t.editor.zoom).toBe(3);
	});

	test('the hint line follows the active tool', async () => {
		const t = await mount({
			doc: emptySpriteDoc('hint', 'hat'),
			id: 'hint',
			role: 'hat',
		});
		const hintRowOf = (s: string) => s.trimEnd().split('\n').at(-1) ?? '';
		expect(hintRowOf(t.captureCharFrame())).toContain('paint:');
		t.editor.key(key('s'));
		await t.renderOnce();
		const hint = hintRowOf(t.captureCharFrame());
		expect(hint).toContain('stamp:');
		expect(hint).toContain('? help');
	});

	test('? opens the complete key-map overlay and esc closes it', async () => {
		const t = await mount({
			doc: emptySpriteDoc('help', 'hat'),
			id: 'help',
			role: 'hat',
			width: 120,
			height: 24,
		});
		t.editor.key(key('?', { sequence: '?' }));
		await t.renderOnce();
		expect(t.editor.helpOpen).toBe(true);
		const frame = t.captureCharFrame();
		expect(frame).toContain('Key map');
		expect(frame).toContain('shift-wheel');
		// Keys are inert while the overlay is up, except closing it.
		t.editor.key(key('space'));
		expect(t.editor.state.history.past.length).toBe(0);
		t.editor.key(key('escape'));
		expect(t.editor.helpOpen).toBe(false);
	});

	test('rail clicks switch tools, pick inks and toggle playback', async () => {
		// Tall enough that the playback box is unfolded (its ', walk' control is
		// only present in the full box, not the folded one-row rung-3 hint).
		const t = await mount({
			doc: emptySpriteDoc('click', 'hat'),
			id: 'click',
			role: 'hat',
			height: 34,
		});
		const lines = t.captureCharFrame().split('\n');
		const rowWith = (needle: string) =>
			lines.findIndex((l) => l.slice(0, RAIL_W).includes(needle));
		// Tool row (erase is demoted to the right button, so the rail lists fill).
		const toolY = rowWith('fill');
		t.editor.mouseDown({
			button: 0,
			x: lines[toolY].indexOf('fill'),
			y: toolY,
		});
		expect(t.editor.state.tool).toBe('fill');
		// Ink grid swatch (the dynamic 'a' entry): locate it by rebuilding the
		// same pure rail model the editor renders and walking to its span.
		const rows = railModel({
			tool: t.editor.state.tool,
			ink: t.editor.state.ink,
			entries: paletteEntries(t.editor.state, STANDARD_PALETTE, {
				p: SPRITE_PREVIEWS.p,
				a: SPRITE_PREVIEWS.a,
			}),
			pose: t.editor.state.pose,
			fps: 8,
			frameCount: 1,
			playMode: 'none',
			onionDepth: 0,
			height: 32,
		});
		let swatch: { x: number; y: number } | null = null;
		for (let y = 0; y < rows.length; y++) {
			let x0 = 0;
			for (const s of rows[y].spans) {
				if (
					s.action?.type === 'ink' &&
					s.action.ink.kind === 'color' &&
					s.action.ink.key === 'a'
				)
					swatch = { x: x0, y };
				x0 += s.text.length;
			}
		}
		if (!swatch) throw new Error("no 'a' swatch in the rail grid");
		t.editor.mouseDown({ button: 0, x: swatch.x, y: swatch.y });
		expect(t.editor.state.ink).toEqual({ kind: 'color', key: 'a' });
		// Playback box.
		const playY = rowWith(', walk');
		t.editor.mouseDown({
			button: 0,
			x: lines[playY].indexOf(', walk'),
			y: playY,
		});
		expect(t.editor.playMode).toBe('walk');
	});
});

describe('Sprite editor shape tools (#394)', () => {
	// Default ×2 zoom: the active block sits at (RAIL_W, 1); a Pixel is 2 cells.
	const bx = RAIL_W;
	const by = 1;
	const at = (px: number, py: number) => ({ x: bx + px * 2, y: by + py * 2 });

	test('the number row selects line/rect/ellipse in rail order', async () => {
		const t = await mount({
			doc: emptySpriteDoc('n', 'hat'),
			id: 'n',
			role: 'hat',
		});
		t.editor.key(key('4', { sequence: '4' }));
		expect(t.editor.state.tool).toBe('line');
		t.editor.key(key('5', { sequence: '5' }));
		expect(t.editor.state.tool).toBe('rect');
		t.editor.key(key('6', { sequence: '6' }));
		expect(t.editor.state.tool).toBe('ellipse');
	});

	test('a mouse drag commits a line as one undo step', async () => {
		const t = await mount({
			doc: emptySpriteDoc('l', 'hat'),
			id: 'l',
			role: 'hat',
		});
		t.editor.key(key('4', { sequence: '4' }));
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 0) });
		t.editor.mouseUp();
		for (let x = 0; x <= 3; x++)
			expect(readPixel(t.editor.state, x, 0)).toBe(true);
		expect(t.editor.state.shape).toBeNull();
		expect(t.editor.state.history.past.length).toBe(1);
	});

	test('a pending shape shows a live preview before release, committing nothing', async () => {
		const t = await mount({
			doc: emptySpriteDoc('p', 'hat'),
			id: 'p',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' })); // rect
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 2) });
		await t.renderOnce();
		expect(t.editor.state.shape).not.toBeNull();
		expect(t.editor.state.doc).toBe(before); // not committed
		// The preview tints canvas blocks in the active ink ('p').
		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(true);
	});

	test('o toggles the rect/ellipse outline↔filled mode', async () => {
		const t = await mount({
			doc: emptySpriteDoc('o', 'hat'),
			id: 'o',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' })); // rect
		expect(t.editor.state.rectMode).toBe('outline');
		t.editor.key(key('o'));
		expect(t.editor.state.rectMode).toBe('filled');
	});

	test('keyboard click-click commits a shape over the same state', async () => {
		const t = await mount({
			doc: emptySpriteDoc('k', 'hat'),
			id: 'k',
			role: 'hat',
		});
		t.editor.key(key('4', { sequence: '4' })); // line
		t.editor.key(key('return')); // place anchor at cursor (0,0)
		for (let i = 0; i < 3; i++) t.editor.key(key('right')); // endpoint (3,0)
		expect(t.editor.state.shape).not.toBeNull();
		t.editor.key(key('return')); // commit
		expect(t.editor.state.shape).toBeNull();
		for (let x = 0; x <= 3; x++)
			expect(readPixel(t.editor.state, x, 0)).toBe(true);
	});

	test('esc cancels a pending shape losslessly', async () => {
		const t = await mount({
			doc: emptySpriteDoc('c', 'hat'),
			id: 'c',
			role: 'hat',
		});
		t.editor.key(key('4', { sequence: '4' }));
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 0) });
		t.editor.key(key('escape'));
		expect(t.editor.state.shape).toBeNull();
		expect(t.editor.state.doc).toBe(before);
	});
});
