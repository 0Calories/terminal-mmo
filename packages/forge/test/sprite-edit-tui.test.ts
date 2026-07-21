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
import {
	RAIL_W,
	type RailRow,
	railActionAt,
	railModel,
} from '../src/sprite-editor/chrome';
import {
	currentFrame,
	frameExtent,
	paletteEntries,
	readPixel,
	setInk,
	TRANSPARENT_INK,
} from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import {
	RENDERER_CLEAR_COLOR,
	SpriteEditor,
	type SpriteKey,
} from '../src/sprite-editor/tui';
import {
	resolveColorKey,
	SPRITE_PREVIEWS,
	variantOptions,
} from '../src/sprite-editor/view';

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
	// Skip rows above this (row 0 carries the variant strip for dynamic-ink
	// docs, whose swatches share the art's colours).
	rowMin = 0,
): number {
	let min = -1;
	for (let y = rowMin; y < Math.min(rowMax, cap.lines.length); y++) {
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
		// Mirror the CLI: register the same clear colour the real editor declares,
		// so the "no cell equals the terminal-default background" invariant is
		// exercised through the same seam production uses.
		backgroundColor: RENDERER_CLEAR_COLOR,
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

// Click the rail button whose label matches `re` in the rendered rail region
// (mouse-primary, QA round 3).
async function clickRail(
	t: Awaited<ReturnType<typeof mount>>,
	re: RegExp,
): Promise<void> {
	await t.renderOnce();
	const rows = t.captureCharFrame().split('\n');
	for (let y = 0; y < rows.length; y++) {
		const m = re.exec(rows[y].slice(0, RAIL_W));
		if (m) {
			t.editor.mouseDown({ button: 0, x: m.index + 1, y });
			t.editor.mouseUp();
			return;
		}
	}
	throw new Error(`no rail button matching ${re}`);
}

// Double-click the first ink grid swatch (row under the ' ink' title). The
// editor's real clock is fine: two immediate calls land well inside the window.
async function dblClickFirstSwatch(
	t: Awaited<ReturnType<typeof mount>>,
): Promise<void> {
	await t.renderOnce();
	const rows = t.captureCharFrame().split('\n');
	const inkY = rows.findIndex(
		(r) => r.slice(0, RAIL_W - 1).trimEnd() === ' ink',
	);
	if (inkY < 0) throw new Error('no ink box title in the rail');
	const y = inkY + 1;
	for (const _ of [0, 1]) {
		t.editor.mouseDown({ button: 0, x: 1, y });
		t.editor.mouseUp();
	}
}

describe('Sprite editor TUI smoke', () => {
	test('opens an existing sprite and renders its frame art as a colour block', async () => {
		// A tiny hat with one lit quadrant (▘) in the idle frame.
		const text = '{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n';
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
		// The status readout is present (the persistent hint line is retired).
		expect(frame).toContain('px (');
	});

	test('a keyboard pen stroke lights a Pixel block on the canvas', async () => {
		const t = await mount({
			doc: emptySpriteDoc('draw', 'hat'),
			id: 'draw',
			role: 'hat',
		});
		t.editor.key(key('p')); // pencil (the launch default is now select)
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
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'flo',
		);
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

		const before = minInkColumn(t.captureSpans(), rgb, 17, 1);
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
		const after = minInkColumn(t.captureSpans(), rgb, 17, 1);
		expect(after).toBeGreaterThan(before); // the art tracked the float right
	});

	test('Enter drops a whole-Frame-shift float from the pencil tool (spec #399)', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'flo2',
		);
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
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'clip',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'clip', role: 'hat' });

		// Select the top-left Pixel (marquee via the select tool: 1).
		t.editor.key(key('1', { sequence: '1' }));
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
		t.editor.key(key('p')); // pencil (the launch default is now select)
		t.editor.key(key('space')); // paint 'p' at TL
		t.editor.key(key('space')); // lift pen
		// Define a fresh file-local colour via the modal (double-click a swatch,
		// QA round 3); it becomes the active ink, so overpainting the same cell
		// coerces rather than being a no-op.
		await dblClickFirstSwatch(t);
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
		t.editor.key(key('s', { ctrl: true })); // save (^s)
		await t.renderOnce();
		expect(existsSync(savePath)).toBe(true);
		expect(readFileSync(savePath, 'utf8')).toContain('--- idle');
		// The inline save summary is shown.
		expect(t.captureCharFrame().toLowerCase()).toContain('saved');
	});

	test('double-clicking a rail swatch opens the colour modal over a hue/shade grid + hex entry', async () => {
		const t = await mount({
			doc: emptySpriteDoc('def', 'hat'),
			id: 'def',
			role: 'hat',
		});
		await dblClickFirstSwatch(t);
		await t.renderOnce();
		expect(t.editor.colorPicker).not.toBeNull();
		expect(t.editor.colorPicker?.mode).toBe('define');
		const frame = t.captureCharFrame();
		expect(frame).toContain('Define file-local colour');
		expect(frame).toContain('hex #');
		// The retired e key no longer opens it.
		t.editor.key(key('escape'));
		expect(t.editor.colorPicker).toBeNull();
		t.editor.key(key('e'));
		expect(t.editor.colorPicker).toBeNull();
	});

	test('double-click detection is clock-driven: two slow clicks never open the modal', async () => {
		let nowMs = 0;
		const clock = () => nowMs;
		const t0 = await createTestRenderer({ width: 100, height: 24 });
		const editor = new SpriteEditor(t0.renderer, {
			id: 'slow',
			role: 'hat',
			doc: emptySpriteDoc('slow', 'hat'),
			save: () => {},
			now: clock,
		});
		editor.attach(t0.renderer.root);
		await t0.renderOnce();
		const rows = t0.captureCharFrame().split('\n');
		const inkY = rows.findIndex(
			(r) => r.slice(0, RAIL_W - 1).trimEnd() === ' ink',
		);
		const y = inkY + 1;
		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		nowMs += 1000; // beyond the double-click window
		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		expect(editor.colorPicker).toBeNull();
		// Two quick clicks (same fake clock instant) do open it.
		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		expect(editor.colorPicker).not.toBeNull();
	});

	test('idle time never recolors dynamic ink — p stays at the selected variant (spec #401 amendment)', async () => {
		// A hat with one lit `p` (dynamic hue) Pixel in the idle frame.
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'stat',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'stat', role: 'hat' });
		const hue = (i: number): [number, number, number] => [
			HUES[i][0],
			HUES[i][1],
			HUES[i][2],
		];
		// The canonical representative (variant 0) renders…
		expect(canvasHasBg(t.captureSpans(), hue(0), 6)).toBe(true);
		// …and stays put through idle time: no clock advances the variant.
		t.editor.tick(5000);
		await t.renderOnce();
		expect(canvasHasBg(t.captureSpans(), hue(0), 6)).toBe(true);
		// No other hue anywhere on the canvas (the rail's variant swatches sit
		// left of RAIL_W and are excluded by the scan).
		expect(minInkColumn(t.captureSpans(), hue(1), 6)).toBe(-1);
	});

	// The rail rows the editor renders for a mounted hat doc, rebuilt through the
	// same pure model, so a test can locate a variant swatch's screen cell.
	function railRowsFor(
		t: Awaited<ReturnType<typeof mount>>,
		usage: { p: boolean; a: boolean },
		active: { p: number; a: number },
	): RailRow[] {
		return railModel({
			tool: t.editor.state.tool,
			ink: t.editor.state.ink,
			entries: paletteEntries(
				t.editor.state,
				STANDARD_PALETTE,
				SPRITE_PREVIEWS,
			),
			animation: t.editor.state.animation,
			fps: 5,
			frameCount: 1,
			playMode: 'none',
			height: 22,
			variants: variantOptions(usage, active),
		});
	}

	// The screen cell of the variant swatch for `channel`/`index` in the rail.
	function variantCell(
		rows: RailRow[],
		channel: 'p' | 'a',
		index: number,
	): { x: number; y: number } {
		for (let y = 0; y < rows.length; y++)
			for (let x = 0; x < RAIL_W; x++) {
				const a = railActionAt(rows, x, y);
				if (a?.type === 'variant' && a.channel === channel && a.index === index)
					return { x, y };
			}
		throw new Error(`no variant swatch for ${channel}[${index}] in the rail`);
	}

	test('clicking a hue swatch on the rail variant rows recolors the p art', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'var',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'var', role: 'hat' });
		const rows = railRowsFor(t, { p: true, a: false }, { p: 0, a: 0 });
		const cell = variantCell(rows, 'p', 2); // the third player hue
		t.editor.mouseDown({ button: 0, x: cell.x, y: cell.y });
		t.editor.mouseUp();
		await t.renderOnce();
		const hue = (i: number): [number, number, number] => [
			HUES[i][0],
			HUES[i][1],
			HUES[i][2],
		];
		// The art now renders the selected hue on the canvas (right of the rail).
		expect(minInkColumn(t.captureSpans(), hue(2), 6)).toBeGreaterThanOrEqual(
			RAIL_W,
		);
		// The click was chrome, not paint: the doc is untouched.
		expect(t.editor.state.history.past.length).toBe(0);
	});

	test('the variant rows live in the rail and only for dynamic-ink art; the canvas never shifts', async () => {
		// Static-key art: no variant rows, and the first strips label on row 0.
		const staticDoc = parseSpriteFile(
			'{"key": "g", "animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'stat2',
		).doc;
		if (!staticDoc) throw new Error('fixture failed to parse');
		const t1 = await mount({ doc: staticDoc, id: 'stat2', role: 'hat' });
		const rows1 = t1.captureCharFrame().split('\n');
		expect(rows1[0].slice(RAIL_W)).toContain('idle');
		expect(rows1.some((r) => / p \[\]/.test(r.slice(0, RAIL_W)))).toBe(false);
		// Dynamic-key art: the rail gains the p variant row; the canvas stays
		// put — the strips label still sits on row 0, no layout jump.
		const pDoc = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'dyn',
		).doc;
		if (!pDoc) throw new Error('fixture failed to parse');
		const t2 = await mount({ doc: pDoc, id: 'dyn', role: 'hat' });
		const rows2 = t2.captureCharFrame().split('\n');
		expect(rows2[0].slice(RAIL_W)).toContain('idle');
		expect(rows2.some((r) => / p \[\]/.test(r.slice(0, RAIL_W)))).toBe(true);
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
		t.editor.key(key('p')); // pencil (the launch default is now select)
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
		t.editor.key(key('p')); // pencil (the launch default is now select)
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
		t.editor.key(key('p')); // pencil (the launch default is now select)
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
		t.editor.key(key('p')); // pencil (the launch default is now select)
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

describe('Focus navigation: enter dives into a frame, esc surfaces to strips', () => {
	const bx = RAIL_W;
	const by = 1;

	test('enter in strips focuses the active frame; esc returns to strips', async () => {
		const t = await mount({
			doc: emptySpriteDoc('nav', 'hat'),
			id: 'nav',
			role: 'hat',
		});
		t.editor.key(key('p')); // pencil: enter dives only when a non-gesture tool is active
		expect(t.editor.view).toBe('strips');
		t.editor.key(key('enter'));
		expect(t.editor.view).toBe('focus');
		t.editor.key(key('escape'));
		expect(t.editor.view).toBe('strips');
	});

	test('tab still toggles the views both ways', async () => {
		const t = await mount({
			doc: emptySpriteDoc('tab', 'hat'),
			id: 'tab',
			role: 'hat',
		});
		t.editor.key(key('tab'));
		expect(t.editor.view).toBe('focus');
		t.editor.key(key('tab'));
		expect(t.editor.view).toBe('strips');
	});

	test('a live float claims enter (drops it) before the view changes', async () => {
		const t = await mount({
			doc: emptySpriteDoc('flt', 'hat'),
			id: 'flt',
			role: 'hat',
		});
		t.editor.key(key('p')); // pencil (the launch default is now select)
		t.editor.key(key('space')); // paint so the shift has art to move
		t.editor.key(key('space'));
		t.editor.key(key('right', { shift: true })); // whole-Frame shift → float
		expect(t.editor.state.float).not.toBeNull();
		t.editor.key(key('enter'));
		expect(t.editor.state.float).toBeNull(); // dropped, not a view switch
		expect(t.editor.view).toBe('strips');
		t.editor.key(key('enter')); // nothing pending now → dive
		expect(t.editor.view).toBe('focus');
	});

	test('esc first clears a selection, then surfaces to strips', async () => {
		const t = await mount({
			doc: emptySpriteDoc('sel', 'hat'),
			id: 'sel',
			role: 'hat',
		});
		t.editor.key(key('1', { sequence: '1' })); // select tool
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseDrag({ button: 0, x: bx + 3, y: by + 1 });
		t.editor.mouseUp();
		expect(t.editor.state.selection).not.toBeNull();
		t.editor.key(key('tab')); // dive with the selection alive
		expect(t.editor.view).toBe('focus');
		t.editor.key(key('escape')); // esc clears the selection first…
		expect(t.editor.state.selection).toBeNull();
		expect(t.editor.view).toBe('focus');
		t.editor.key(key('escape')); // …then surfaces
		expect(t.editor.view).toBe('strips');
	});

	test('the shape gesture keeps claiming enter (anchor then commit, no view switch)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('shp', 'hat'),
			id: 'shp',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' })); // line tool
		t.editor.key(key('enter')); // places the shape anchor
		expect(t.editor.state.shape).not.toBeNull();
		expect(t.editor.view).toBe('strips');
		t.editor.key(key('right'));
		t.editor.key(key('enter')); // commits the shape
		expect(t.editor.state.shape).toBeNull();
		expect(t.editor.view).toBe('strips');
	});
});

describe('Sprite editor palette rail: eyedrop + crop rebind (#397)', () => {
	const bx = RAIL_W;
	const by = 1;

	test('crop has left the rail (round 3: the canvas-size modal absorbs it)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('sizing', 'hat'),
			id: 'sizing',
			role: 'hat',
		});
		await t.renderOnce();
		const rail = t
			.captureCharFrame()
			.split('\n')
			.map((r) => r.slice(0, RAIL_W))
			.join('\n');
		expect(rail).not.toContain('crop');
		// The `⤢ canvas` button replaces the old resize + crop buttons.
		expect(rail).toContain('canvas');
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

	test('alt-click eyedrops the key under the pointer; the i key is retired', async () => {
		const t = await mount({
			doc: emptySpriteDoc('eye', 'hat'),
			id: 'eye',
			role: 'hat',
		});
		const painted = t.editor.state.ink; // the doc's default key
		t.editor.key(key('p')); // pencil (the launch default is now select)
		t.editor.key(key('space')); // paint at cursor (0,0)
		t.editor.key(key('space')); // lift pen
		t.editor.state = setInk(t.editor.state, TRANSPARENT_INK); // move ink away
		t.editor.key(key('i')); // retired: must NOT eyedrop (QA round 3)
		expect(t.editor.state.ink).toEqual({ kind: 'transparent' });
		// The momentary alt-click spelling still samples the lit Pixel. The
		// active frame's block starts at (RAIL_W, 1) in the strips view.
		t.editor.mouseDown({
			button: 0,
			x: RAIL_W,
			y: 1,
			modifiers: { alt: true },
		});
		t.editor.mouseUp();
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
		t.editor.key(key('p')); // pencil (the launch default is now select)
		t.editor.mouseDown({ button: 0, x: bx, y: by }); // paint a Pixel
		t.editor.mouseUp();
		t.editor.state = setInk(t.editor.state, TRANSPARENT_INK); // ink → transparent
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, x: bx, y: by, modifiers: { alt: true } });
		t.editor.mouseUp();
		expect(t.editor.state.ink).toEqual(painted); // sampled back
		expect(readPixel(t.editor.state, 0, 0)).toBe(true); // art untouched
		expect(t.editor.state.doc).toBe(before);
	});
});

describe('canvas-size modal (round 3): resize + crop in one gesture', () => {
	test('canvas opens the modal; a/d nudge the armed (right) edge; enter applies', async () => {
		const t = await mount({
			doc: emptySpriteDoc('rz', 'hat'),
			id: 'rz',
			role: 'hat',
		});
		const w0 = frameExtent(currentFrame(t.editor.state)).w;
		await clickRail(t, /\bcanvas\b/);
		expect(t.editor.canvasModal).not.toBeNull();
		// The doc is untouched while the modal is live — only enter commits.
		t.editor.key(key('d')); // grow the right edge out
		t.editor.key(key('d'));
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(w0); // not yet
		t.editor.key(key('a')); // shrink one back in (net +1)
		t.editor.key(key('l')); // retired vim spellings: ignored by the modal
		t.editor.key(key('h'));
		t.editor.key(key('return')); // apply
		expect(t.editor.canvasModal).toBeNull();
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(w0 + 1);
	});

	test('the modal apply is one undo step; esc cancels with no change', async () => {
		const t = await mount({
			doc: emptySpriteDoc('rzv', 'hat'),
			id: 'rzv',
			role: 'hat',
		});
		const before = t.editor.state.doc;
		const w0 = frameExtent(currentFrame(t.editor.state)).w;
		// Apply a grow, then undo back to the original doc.
		await clickRail(t, /\bcanvas\b/);
		t.editor.key(key('d'));
		t.editor.key(key('return'));
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(w0 + 1);
		t.editor.key(key('u')); // undo
		expect(t.editor.state.doc).toBe(before);
		// esc leaves the modal without touching the doc.
		await clickRail(t, /\bcanvas\b/);
		t.editor.key(key('d'));
		t.editor.key(key('escape'));
		expect(t.editor.canvasModal).toBeNull();
		expect(t.editor.state.doc).toBe(before);
	});

	test('dragging an edge of the bounds rectangle grows the canvas', async () => {
		const t = await mount({
			doc: emptySpriteDoc('rzd', 'hat'),
			id: 'rzd',
			role: 'hat',
		});
		const w0 = frameExtent(currentFrame(t.editor.state)).w;
		await clickRail(t, /\bcanvas\b/);
		await t.renderOnce();
		// biome-ignore lint/suspicious/noExplicitAny: reach the private modal geom.
		const g = (t.editor as any).geom.canvasModal;
		if (!g) throw new Error('canvas modal geometry not recorded');
		// Grab the right border and drag it two cells (cw each) further right.
		const midY = Math.floor((g.topY + g.bottomY) / 2);
		t.editor.mouseDown({ button: 0, x: g.rightX, y: midY });
		t.editor.mouseDrag({ button: 0, x: g.rightX + 2 * g.cw, y: midY });
		t.editor.mouseUp();
		t.editor.key(key('return'));
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(w0 + 2);
	});

	test('the modal titles the live size and paints no clear-colour cell', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n██\n██\n',
			'blk',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'blk', role: 'hat' });
		await clickRail(t, /\bcanvas\b/);
		t.editor.key(key('a')); // shrink the right edge one cell (clips a column)
		await t.renderOnce();
		const frame = t.captureCharFrame();
		// The title reads the live before → after size.
		expect(frame).toContain('canvas 2×2 → 1×2');
		// The declared clear colour is never painted, even with the modal open.
		const CLEAR = hexToInts(RENDERER_CLEAR_COLOR);
		const cap = t.captureSpans();
		for (let y = 0; y < cap.lines.length; y++)
			for (const s of cap.lines[y].spans) {
				const [r, g, b] = s.bg.toInts();
				expect([r, g, b]).not.toEqual(CLEAR);
			}
	});

	test('a column the shrink would clip renders in the warning colour', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n██\n██\n',
			'clip',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'clip', role: 'hat' });
		await clickRail(t, /\bcanvas\b/);
		t.editor.key(key('a')); // shrink right → the last inked column would clip
		await t.renderOnce();
		// The warning shade is Palette.feedback = (255,180,80).
		const WARN: [number, number, number] = [255, 180, 80];
		const cap = t.captureSpans();
		let found = false;
		for (let y = 0; y < cap.lines.length && !found; y++)
			for (const s of cap.lines[y].spans) {
				const [r, g, b] = s.bg.toInts();
				if (r === WARN[0] && g === WARN[1] && b === WARN[2]) found = true;
			}
		expect(found).toBe(true);
	});

	test('the modal renders the real Default-frame glyph + fg/bg, not a solid block (#411)', async () => {
		// The Default frame's cell (0,0) is a PARTIAL-quadrant glyph (▘) with distinct
		// custom fg + bg. The old modal read the raw glyph, treated it as fully lit,
		// and stamped a solid space cell in fg only (bg dropped). The fixed modal
		// reuses the shared frame renderer, so the buffer must carry the actual glyph
		// with both resolved colours.
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}],"colors":{"q":[10,20,30,255],"s":[200,100,50,255]}}\n--- idle\n▘·\n··\n@colors\nq·\n··\n@bg\ns·\n··\n',
			'real',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'real', role: 'hat' });
		await clickRail(t, /\bcanvas\b/);
		await t.renderOnce();
		const cap = t.captureSpans();
		const cell = (x: number, y: number) => {
			let col = 0;
			for (const s of cap.lines[y].spans) {
				if (x < col + s.width)
					return {
						ch: s.text[x - col] ?? ' ',
						fg: s.fg.toInts(),
						bg: s.bg.toInts(),
					};
				col += s.width;
			}
			return null;
		};
		// Scope the search to the modal box (the always-on preview pane also renders
		// the sprite, so an unscoped glyph search would find it there — this test is
		// specifically about the MODAL's own render).
		// biome-ignore lint/suspicious/noExplicitAny: reach the private modal geom.
		const box = (t.editor as any).geom.canvasModal?.box as
			| { ox: number; oy: number; w: number; h: number }
			| undefined;
		if (!box) throw new Error('canvas modal geometry not recorded');
		// Locate the real glyph inside the modal: the old code never emitted it here
		// (solid blocks are space cells), so its presence proves the render path.
		let hit: { x: number; y: number } | null = null;
		for (let y = box.oy; y < box.oy + box.h && !hit; y++) {
			let col = 0;
			for (const s of cap.lines[y].spans) {
				for (let k = 0; k < s.text.length; k++) {
					const gx = col + k;
					if (s.text[k] === '▘' && gx >= box.ox && gx < box.ox + box.w) {
						hit = { x: gx, y };
						break;
					}
				}
				if (hit) break;
				col += s.width;
			}
		}
		if (!hit)
			throw new Error(
				'the Default frame glyph ▘ was not rendered in the modal',
			);
		const lit = cell(hit.x, hit.y);
		expect(lit?.ch).toBe('▘');
		// The fg is the resolved custom key `q`, and the bg the resolved `s` — bg is
		// no longer dropped.
		expect(lit?.fg.slice(0, 3)).toEqual([10, 20, 30]);
		expect(lit?.bg.slice(0, 3)).toEqual([200, 100, 50]);
		// The empty cell to the glyph's right (inside bounds) is NOT painted as ink:
		// no glyph, and neither the fg nor bg ink colour.
		const empty = cell(hit.x + 1, hit.y);
		expect(empty?.ch).toBe(' ');
		expect(empty?.bg.slice(0, 3)).not.toEqual([10, 20, 30]);
		expect(empty?.bg.slice(0, 3)).not.toEqual([200, 100, 50]);
	});
});

describe('Sprite editor chrome (#392): rail, strips/focus, navigation, help', () => {
	// A two-frame animation: frames 'a' and 'b' side by side in one strip.
	function twoFrameDoc(): ReturnType<typeof emptySpriteDoc> {
		const frame = () => ({
			rows: ['  ', '  '],
			colors: ['  ', '  '],
			bg: ['  ', '  '],
			anchors: {},
		});
		// A single two-frame animation: its frames are unnamed (ADR 0037), so their
		// identity labels are 'idle 0' and 'idle 1'.
		return {
			id: 'duo',
			key: 'p',
			baseline: 0,
			anchors: {},
			animations: [{ name: 'idle', frames: [frame(), frame()] }],
			colors: {},
		};
	}

	test('the left rail carries the tools row, ink list and the edit box', async () => {
		// A tall terminal so the full edit box shows (rung 3 folds it when the rail
		// can't fit the full ink list + box — e.g. at the 24-row floor).
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
		// The three control boxes fused into one `edit` box (round 3); onion, frame
		// creation, and the resize/crop buttons left the rail.
		expect(rail).toContain('edit');
		expect(rail).toContain('animation');
		expect(rail).toContain('canvas');
		expect(rail).not.toContain('◌ onion');
		expect(rail).not.toContain('✚ frame');
		expect(rail).not.toContain('playback');
		// No `fps` text survives in the rail (the status row below carries the
		// animation readout).
		expect(rail).not.toContain('fps');
	});

	test('strips view labels every animation and underlines the active frame', async () => {
		const t = await mount({
			doc: twoFrameDoc(),
			id: 'duo',
			role: 'hat',
		});
		const frame = t.captureCharFrame();
		expect(t.editor.view).toBe('strips');
		// The strip label is just the animation name; the multi-frame strip also
		// carries its interactive fps stepper on that row.
		expect(frame).toContain('idle');
		expect(frame).toContain('‹ 5fps ›');
		// Frames are unnamed (ADR 0037): the name row shows each frame's `frame N`
		// position, and the Default frame (frame 0 of the first animation) carries
		// the ◈ badge. The active frame 0 is the default here.
		const nameRow = frame.split('\n').find((l) => l.includes('◈frame 0'));
		expect(nameRow).toBeDefined();
		expect(nameRow).toContain('◈frame 0');
		expect(nameRow).toContain('frame 1');
	});

	test('clicking another frame activates it AND applies the tool (click-through)', async () => {
		const t = await mount({ doc: twoFrameDoc(), id: 'duo', role: 'hat' });
		t.editor.key(key('p')); // pencil: click-through paints (launch default is select)
		expect(t.editor.state.frame).toBe('idle 0');
		// Frame 1's block: 2×2 cells → 4×4 Pixels → ×2 → 8 cols; gap 2 → x offset 10.
		t.editor.mouseDown({ button: 0, x: RAIL_W + 10, y: 1 });
		t.editor.mouseUp();
		expect(t.editor.state.frame).toBe('idle 1');
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
	});

	test('tab toggles focus mode with a frame-name tab row', async () => {
		const t = await mount({ doc: twoFrameDoc(), id: 'duo', role: 'hat' });
		t.editor.key(key('tab'));
		await t.renderOnce();
		expect(t.editor.view).toBe('focus');
		const tabRow = t.captureCharFrame().split('\n')[0].slice(RAIL_W);
		// Frames are unnamed (ADR 0037): the tab row reads `frame N` by position.
		expect(tabRow).toContain('frame 0 │ frame 1');
		// Clicking the second tab activates that frame ('idle 1').
		const bCol = RAIL_W + tabRow.indexOf('1', tabRow.indexOf('│'));
		t.editor.mouseDown({ button: 0, x: bCol, y: 0 });
		expect(t.editor.state.frame).toBe('idle 1');
		t.editor.key(key('tab'));
		expect(t.editor.view).toBe('strips');
	});

	test('wheel scrolls the strips; ctrl-wheel zooms; middle-drag pans', async () => {
		// A form doc with a third (jump) strip so there is content below the fold.
		const base = emptySpriteDoc('nav', 'form');
		// A third single-frame animation ('jump') so there is content below the fold.
		const navDoc = {
			...base,
			animations: [
				...base.animations,
				{ name: 'jump', frames: [base.animations[0].frames[0]] },
			],
		};
		const t = await mount({ doc: navDoc, id: 'nav', role: 'form' });
		// jump's strip label sits at content row ~38 — off-screen at the 24-row
		// floor (viewH=22), below both the idle and walk strips.
		expect(t.captureCharFrame()).not.toContain('jump');
		t.editor.wheel({ button: 0, x: 40, y: 5, scroll: { direction: 'down' } });
		await t.renderOnce();
		// One notch (3 rows) brings nothing yet; keep scrolling.
		for (let i = 0; i < 5; i++)
			t.editor.wheel({ button: 0, x: 40, y: 5, scroll: { direction: 'down' } });
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('jump');
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

	test('the fps stepper on a multi-frame strip steps the animation fps, clamped (QA round 3)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('fps', 'form'),
			id: 'fps',
			role: 'form',
		});
		// Zoom out so the walk strip's name row (carrying ‹ 5fps ›) is on screen.
		t.editor.key(key('-', { sequence: '-' }));
		await t.renderOnce();
		const find = (glyph: string) => {
			const rows = t.captureCharFrame().split('\n');
			for (let y = 0; y < rows.length; y++) {
				const x = rows[y].indexOf(glyph, RAIL_W);
				if (x >= 0) return { x, y };
			}
			throw new Error(`no ${glyph} on screen`);
		};
		// fps now lives on the animation object (ADR 0037), not a top-level map.
		const walkFps = () =>
			t.editor.state.doc.animations.find((a) => a.name === 'walk')?.fps;
		const dec = find('‹');
		t.editor.mouseDown({ button: 0, x: dec.x, y: dec.y });
		t.editor.mouseUp();
		expect(walkFps()).toBe(4);
		// Down to the floor: clamped at 1.
		for (let i = 0; i < 6; i++) {
			const d = find('‹');
			t.editor.mouseDown({ button: 0, x: d.x, y: d.y });
			t.editor.mouseUp();
			await t.renderOnce();
		}
		expect(walkFps()).toBe(1);
		// The › chevron steps back up.
		const inc = find('›');
		t.editor.mouseDown({ button: 0, x: inc.x, y: inc.y });
		t.editor.mouseUp();
		expect(walkFps()).toBe(2);
		// A stepper edit is undoable like any doc mutation.
		t.editor.key(key('u'));
		expect(walkFps()).toBe(1);
	});

	test('the bottom row is the status readout — the persistent hint line is gone (QA round 3)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('hint', 'hat'),
			id: 'hint',
			role: 'hat',
		});
		const rows = t.captureCharFrame().trimEnd().split('\n');
		const last = rows[rows.length - 1];
		expect(last).toContain('px (');
		expect(last).not.toContain('paint:');
		// The freed row belongs to the canvas: only ONE chrome row at the bottom.
		expect(rows[rows.length - 2]).not.toContain('px (');
	});

	test('wasd moves the cursor; hjkl and the dead letter keys are inert', async () => {
		const t = await mount({
			doc: emptySpriteDoc('wasd', 'hat'),
			id: 'wasd',
			role: 'hat',
		});
		t.editor.key(key('d'));
		t.editor.key(key('s'));
		expect(t.editor.state.cursor).toEqual({ x: 1, y: 1 });
		t.editor.key(key('a'));
		t.editor.key(key('w'));
		expect(t.editor.state.cursor).toEqual({ x: 0, y: 0 });
		// hjkl are dead: the cursor stays put.
		for (const k of ['h', 'j', 'k', 'l']) t.editor.key(key(k));
		expect(t.editor.state.cursor).toEqual({ x: 0, y: 0 });
		// The dead letters neither move nor mutate: n/m/v/t/e/o/R/P/A/O and the
		// frame-step brackets are inert.
		const before = t.editor.state;
		for (const kk of ['n', 'm', 'v', 't', 'e', 'o']) t.editor.key(key(kk));
		for (const sq of ['[', ']', '{', '}', 'P', 'A', 'R', 'O', '.', ','])
			t.editor.key(key(sq, { sequence: sq }));
		expect(t.editor.state.doc).toBe(before.doc);
		expect(t.editor.state.frame).toBe(before.frame);
		expect(t.editor.playMode).toBe('none');
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
		expect(frame).toContain('dbl-click swatch');
		// Keys are inert while the overlay is up, except closing it.
		t.editor.key(key('space'));
		expect(t.editor.state.history.past.length).toBe(0);
		t.editor.key(key('escape'));
		expect(t.editor.helpOpen).toBe(false);
	});

	test('rail clicks switch tools, pick inks and cycle a control box button', async () => {
		// Tall enough that the full control boxes are unfolded (their buttons are
		// only present in the full boxes, not the folded one-row rung-3 hint).
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
			animation: t.editor.state.animation,
			fps: 8,
			frameCount: 1,
			playMode: 'none',
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
	});
});

describe('select drag renders the dotted marquee, never ink (ADR 0036)', () => {
	test('an in-progress select drag draws · marquee cells, not ink-tinted blocks', async () => {
		const t = await mount({
			doc: emptySpriteDoc('marq', 'hat'),
			id: 'marq',
			role: 'hat',
		});
		t.editor.key(key('1', { sequence: '1' })); // select tool
		// Drag from the block origin (RAIL_W, 1) — in-progress, not released.
		t.editor.mouseDown({ button: 0, x: RAIL_W, y: 1 });
		t.editor.mouseDrag({ button: 0, x: RAIL_W + 6, y: 5 });
		await t.renderOnce();
		const cap = t.captureSpans();
		const cellAt = (x: number, y: number) => {
			let col = 0;
			for (const sp of cap.lines[y].spans) {
				if (x < col + sp.width)
					return { ch: sp.text[x - col] ?? ' ', bg: sp.bg.toInts() };
				col += sp.width;
			}
			return null;
		};
		const origin = cellAt(RAIL_W, 1);
		// The dotted ants, not a blank ink block.
		expect(origin?.ch).toBe('·');
		// And nowhere does the drag paint the active ink colour (p) as a block.
		expect(
			canvasHasBg(
				t.captureSpans(),
				[STANDARD_PALETTE.p[0], STANDARD_PALETTE.p[1], STANDARD_PALETTE.p[2]],
				10,
			),
		).toBe(false);
		// The pending select shape carries no captured ink at all.
		expect(t.editor.state.shape?.tool).toBe('select');
		expect(t.editor.state.shape?.ink).toEqual(TRANSPARENT_INK);
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
		t.editor.key(key('5', { sequence: '5' }));
		expect(t.editor.state.tool).toBe('line');
		t.editor.key(key('6', { sequence: '6' }));
		expect(t.editor.state.tool).toBe('rect');
		t.editor.key(key('7', { sequence: '7' }));
		expect(t.editor.state.tool).toBe('ellipse');
	});

	test('a mouse drag commits a line as one undo step', async () => {
		const t = await mount({
			doc: emptySpriteDoc('l', 'hat'),
			id: 'l',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' })); // line
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
		t.editor.key(key('6', { sequence: '6' })); // rect
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 2) });
		await t.renderOnce();
		expect(t.editor.state.shape).not.toBeNull();
		expect(t.editor.state.doc).toBe(before); // not committed
		// The preview tints canvas blocks in the active ink ('p').
		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(true);
	});

	test('clicking the active rect tool button toggles outline↔filled (QA round 3: o is retired)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('o', 'hat'),
			id: 'o',
			role: 'hat',
		});
		t.editor.key(key('6', { sequence: '6' })); // rect
		expect(t.editor.state.rectMode).toBe('outline');
		await clickRail(t, /\brect\b/); // already active → toggles mode
		expect(t.editor.state.rectMode).toBe('filled');
		t.editor.key(key('o')); // retired: inert
		expect(t.editor.state.rectMode).toBe('filled');
	});

	test('keyboard click-click commits a shape over the same state', async () => {
		const t = await mount({
			doc: emptySpriteDoc('k', 'hat'),
			id: 'k',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' })); // line
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
		t.editor.key(key('5', { sequence: '5' })); // line
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 0) });
		t.editor.key(key('escape'));
		expect(t.editor.state.shape).toBeNull();
		expect(t.editor.state.doc).toBe(before);
	});
});

// The `#rrggbb` string as the RGBA ints RGBA.fromInts produces, so a captured
// span's background can be compared to a palette/clear colour.
function hexToInts(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	];
}

describe('TUI opacity: no cell collapses to the terminal-default background (concern 1)', () => {
	// The declared clear colour (what a translucent terminal composites against
	// the window). The editor paints every cell opaquely, so NO chrome or canvas
	// cell may be painted this colour — otherwise it shows the wallpaper through.
	const CLEAR = hexToInts(RENDERER_CLEAR_COLOR);
	// The transparency checker's distinctive shade (Palette.grid); its twin phase
	// is Palette.bg. Confined to a frame's actual bounds, it never tiles margins.
	const GRID: [number, number, number] = [28, 32, 44];

	test('no chrome or canvas cell is painted the declared clear colour', async () => {
		const t = await mount({
			doc: emptySpriteDoc('bg', 'form'),
			id: 'bg',
			role: 'form',
		});
		await t.renderOnce();
		const cap = t.captureSpans();
		for (let y = 0; y < cap.lines.length; y++)
			for (const s of cap.lines[y].spans) {
				const [r, g, b] = s.bg.toInts();
				expect([r, g, b]).not.toEqual(CLEAR);
			}
	});

	test('focus view confines the checker to the frame; the margin is the plain surround', async () => {
		const t = await mount({
			doc: emptySpriteDoc('foc', 'form'),
			id: 'foc',
			role: 'form',
		});
		t.editor.key(key('tab')); // strips → focus
		expect(t.editor.view).toBe('focus');
		await t.renderOnce();

		// biome-ignore lint/suspicious/noExplicitAny: reach the private render geometry.
		const geom = (t.editor as any).geom as {
			focus: { origin: { x: number; y: number }; top: number };
			viewH: number;
		};
		const { origin, top } = geom.focus;
		const z = t.editor.zoom;
		const { w, h } = frameExtent(currentFrame(t.editor.state));
		const fx1 = origin.x + Math.max(1, w * 2) * z;
		const fy1 = origin.y + Math.max(1, h * 2) * z;

		const cap = t.captureSpans();
		let checkerInFrame = 0;
		for (let y = top; y < Math.min(geom.viewH, cap.lines.length); y++) {
			let col = 0;
			for (const s of cap.lines[y].spans) {
				const [r, g, b] = s.bg.toInts();
				if (r === GRID[0] && g === GRID[1] && b === GRID[2])
					for (let c = col; c < col + s.width; c++) {
						const inFrame =
							c >= origin.x && c < fx1 && y >= origin.y && y < fy1;
						// Every checker cell lands inside the frame — never the margin.
						expect(inFrame).toBe(true);
						if (inFrame) checkerInFrame++;
					}
				col += s.width;
			}
		}
		// The frame still shows the transparency checker (it is not all-plain).
		expect(checkerInFrame).toBeGreaterThan(0);
	});
});

describe('focus filmstrip (post-#351)', () => {
	// A three-frame walk, every frame lighting the same top-left Pixel so the lit
	// screen cell sits at each frame box's (x0, origin.y).
	const WALK3 =
		'{"animations":[{"name":"walk"}]}\n' +
		'--- walk 0\n▘·\n··\n' +
		'--- walk 1\n▘·\n··\n' +
		'--- walk 2\n▘·\n··\n';

	async function mountWalk() {
		const { doc } = parseSpriteFile(WALK3, 'film');
		if (!doc) throw new Error('walk fixture failed to parse');
		const t = await mount({ doc, id: 'film', role: 'hat' });
		// Force the floating Composited preview off so it never overlaps the
		// filmstrip's right-hand neighbours (it floats over the top-right).
		// biome-ignore lint/suspicious/noExplicitAny: set the private preview override.
		(t.editor as any).previewOverride = false;
		t.editor.key(key('tab')); // strips → focus
		await t.renderOnce();
		return t;
	}

	// biome-ignore lint/suspicious/noExplicitAny: reach the private render geometry.
	const focusGeom = (t: Awaited<ReturnType<typeof mount>>) =>
		(t.editor as any).geom.focus as {
			origin: { x: number; y: number };
			top: number;
			pxH: number;
			frames: { name: string; x0: number; x1: number }[];
		};

	const bgAt = (
		cap: ReturnType<
			Awaited<ReturnType<typeof createTestRenderer>>['captureSpans']
		>,
		x: number,
		y: number,
	): [number, number, number] => {
		let col = 0;
		for (const s of cap.lines[y].spans) {
			if (x >= col && x < col + s.width) {
				const [r, g, b] = s.bg.toInts();
				return [r, g, b];
			}
			col += s.width;
		}
		return [-1, -1, -1];
	};

	test('renders the whole animation: one box per frame, the active centred', async () => {
		const t = await mountWalk();
		const f = focusGeom(t);
		expect(f.frames.map((b) => b.name)).toEqual(['walk 0', 'walk 1', 'walk 2']);
		// The active frame (walk 0) is the centred origin; its neighbours sit to the
		// right at ascending x.
		const active = f.frames.find((b) => b.name === 'walk 0');
		expect(active?.x0).toBe(f.origin.x);
		const w1 = f.frames.find((b) => b.name === 'walk 1');
		const w2 = f.frames.find((b) => b.name === 'walk 2');
		expect(w1 && active && w1.x0 > active.x0).toBe(true);
		expect(w2 && w1 && w2.x0 > w1.x0).toBe(true);
	});

	test('a neighbour frame renders dimmer than the active frame', async () => {
		const t = await mountWalk();
		const f = focusGeom(t);
		const cap = t.captureSpans();
		const active = f.frames.find((b) => b.name === 'walk 0');
		const neighbour = f.frames.find((b) => b.name === 'walk 1');
		if (!active || !neighbour) throw new Error('missing boxes');
		// Each frame's lit Pixel (0,0) is the cell at (box.x0, origin.y).
		const lit = bgAt(cap, active.x0, f.origin.y);
		const dim = bgAt(cap, neighbour.x0, f.origin.y);
		const sum = (c: number[]) => c[0] + c[1] + c[2];
		// The neighbour's colours are genuinely dimmed, not merely decorated.
		expect(sum(dim)).toBeLessThan(sum(lit));
		expect(sum(dim)).toBeGreaterThan(0);
	});

	test('the margins and inter-frame gaps stay the plain opaque surround', async () => {
		const t = await mountWalk();
		const f = focusGeom(t);
		const cap = t.captureSpans();
		// The gap column just right of the active frame's box is plain C.bg
		// (16,18,26) — never the checker, art, or the declared clear colour.
		const active = f.frames.find((b) => b.name === 'walk 0');
		if (!active) throw new Error('no active box');
		const gap = bgAt(cap, active.x1, f.origin.y);
		expect(gap).toEqual([16, 18, 26]);
	});

	test('← / → step the active frame under the launch-default select tool (no marquee)', async () => {
		const t = await mountWalk();
		// No tool switch: the editor launches on select (commit 4bf75e2), and with
		// no marquee pending the arrows do nothing for select — so they are free to
		// navigate frames. Tool identity alone must not suppress frame-stepping.
		expect(t.editor.state.tool).toBe('select');
		expect(t.editor.state.shape).toBeNull();
		expect(t.editor.state.selection).toBeNull();
		expect(t.editor.state.frame).toBe('walk 0');
		t.editor.key(key('right'));
		expect(t.editor.state.frame).toBe('walk 1');
		t.editor.key(key('left'));
		expect(t.editor.state.frame).toBe('walk 0');
	});

	test('a pending select marquee keeps the arrows (they grow it, not the frame)', async () => {
		const t = await mountWalk();
		// Drop a marquee anchor (select is the default tool): now a live gesture owns
		// the arrows, so → grows the marquee and the active frame does NOT change.
		t.editor.key(key('return')); // anchor the select marquee at the cursor
		expect(t.editor.state.shape).not.toBeNull();
		const frameBefore = t.editor.state.frame;
		t.editor.key(key('right'));
		expect(t.editor.state.frame).toBe(frameBefore);
		expect(t.editor.state.shape?.to.x).toBeGreaterThan(
			t.editor.state.shape?.anchor.x ?? 0,
		);
	});

	test('← / → step the active frame with wrap (pencil active)', async () => {
		const t = await mountWalk();
		t.editor.key(key('p')); // a non-gesture tool: arrows navigate frames
		expect(t.editor.state.frame).toBe('walk 0');
		t.editor.key(key('left')); // wrap back to the last frame
		expect(t.editor.state.frame).toBe('walk 2');
		t.editor.key(key('right')); // wrap forward
		expect(t.editor.state.frame).toBe('walk 0');
		t.editor.key(key('right'));
		expect(t.editor.state.frame).toBe('walk 1');
	});

	test('clicking a dimmed neighbour activates it without painting', async () => {
		const t = await mountWalk();
		const before = t.editor.state.doc;
		const f = focusGeom(t);
		const neighbour = f.frames.find((b) => b.name === 'walk 1');
		if (!neighbour) throw new Error('no neighbour box');
		// Click an unlit cell inside the neighbour box (its Pixel (1,0) is dark).
		t.editor.mouseDown({ button: 0, x: neighbour.x0 + 2, y: f.origin.y });
		t.editor.mouseUp();
		expect(t.editor.state.frame).toBe('walk 1');
		expect(t.editor.state.doc).toBe(before); // activation never paints
	});

	test('playback keeps the display single-frame', async () => {
		const t = await mountWalk();
		// biome-ignore lint/suspicious/noExplicitAny: drive playback + read geometry.
		const ed = t.editor as any;
		ed.togglePlay('animation');
		await t.renderOnce();
		expect(focusGeom(t).frames).toHaveLength(1);
	});
});
