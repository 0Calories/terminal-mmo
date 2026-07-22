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

const INK_P: [number, number, number] = [
	SPRITE_PREVIEWS.p[0],
	SPRITE_PREVIEWS.p[1],
	SPRITE_PREVIEWS.p[2],
];

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

function minInkColumn(
	cap: ReturnType<
		Awaited<ReturnType<typeof createTestRenderer>>['captureSpans']
	>,
	rgb: [number, number, number],
	rowMax: number,

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

		height: opts.height ?? 24,

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
		const text = '{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n';
		const { doc } = parseSpriteFile(text, 'cap');
		if (!doc) throw new Error('fixture failed to parse');
		const { captureCharFrame, captureSpans, editor } = await mount({
			doc,
			id: 'cap',
			role: 'hat',
		});

		const chars = captureCharFrame();
		expect(chars).toContain('cap');
		expect(chars).toContain('(hat)');

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
		const t = await mount({
			doc: emptySpriteDoc('newhat', 'hat'),
			id: 'newhat',
			role: 'hat',
			initialFeedback: 'creating new sprite hats/newhat',

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

		expect(frame).toContain('px (');
	});

	test('a keyboard pen stroke lights a Pixel block on the canvas', async () => {
		const t = await mount({
			doc: emptySpriteDoc('draw', 'hat'),
			id: 'draw',
			role: 'hat',
		});
		t.editor.key(key('p'));

		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(false);

		t.editor.key(key('space'));
		t.editor.key(key('right'));
		t.editor.key(key('down'));
		t.editor.key(key('left'));
		t.editor.key(key('space'));
		await t.renderOnce();
		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(true);

		expect(t.editor.state.history.past.length).toBe(1);
	});

	test('a whole-Frame shift floats the art live on the canvas (spec #399)', async () => {
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
		expect(before).toBeGreaterThanOrEqual(0);

		t.editor.key(key('right', { shift: true }));
		t.editor.key(key('right', { shift: true }));
		t.editor.key(key('right', { shift: true }));
		await t.renderOnce();

		expect(t.editor.state.float).not.toBeNull();
		expect(t.editor.state.float?.dx).toBe(3);
		const after = minInkColumn(t.captureSpans(), rgb, 17, 1);
		expect(after).toBeGreaterThan(before);
	});

	test('Enter drops a whole-Frame-shift float from the pencil tool (spec #399)', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'flo2',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'flo2', role: 'hat' });

		t.editor.key(key('down', { shift: true }));
		expect(t.editor.state.float).not.toBeNull();
		const before = t.editor.state.history.past.length;

		t.editor.key(key('return'));
		expect(t.editor.state.float).toBeNull();
		expect(t.editor.state.history.past.length).toBe(before + 1);

		expect(readPixel(t.editor.state, 0, 0)).toBe(false);
		expect(readPixel(t.editor.state, 0, 1)).toBe(true);
	});

	test('y copies and 9 pastes a float at the source through the keyboard (spec #400)', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'clip',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'clip', role: 'hat' });

		t.editor.key(key('1', { sequence: '1' }));
		t.editor.key(key('return'));
		t.editor.key(key('return'));
		expect(t.editor.state.selection).not.toBeNull();

		const beforeHist = t.editor.state.history.past.length;
		t.editor.key(key('y', { sequence: 'y' }));
		expect(t.editor.state.clipboard?.pixels).toHaveLength(1);
		expect(t.editor.state.history.past.length).toBe(beforeHist);

		t.editor.key(key('9', { sequence: '9' }));
		expect(t.editor.state.float).not.toBeNull();
		expect(t.editor.state.tool).toBe('move');

		t.editor.key(key('right'));
		t.editor.key(key('right'));
		t.editor.key(key('return'));
		expect(t.editor.state.float).toBeNull();

		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		expect(readPixel(t.editor.state, 2, 0)).toBe(true);
	});

	test('the status line shows the zoom and Pixel/cell coordinates', async () => {
		const t = await mount({
			doc: emptySpriteDoc('coords', 'hat'),
			id: 'coords',
			role: 'hat',
		});
		t.editor.key(key('right'));
		await t.renderOnce();
		const frame = t.captureCharFrame();
		expect(frame).toContain('×2');
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
		t.editor.key(key('-', { sequence: '-' }));
		expect(t.editor.zoom).toBe(1);
	});

	test('a coercing paint surfaces its feedback right-aligned on the status line', async () => {
		const t = await mount({
			doc: emptySpriteDoc('bad', 'hat'),
			id: 'bad',
			role: 'hat',
			width: 140,
		});
		t.editor.key(key('p'));
		t.editor.key(key('space'));
		t.editor.key(key('space'));

		await dblClickFirstSwatch(t);
		expect(t.editor.colorPicker).not.toBeNull();
		t.editor.key(key('enter'));
		expect(t.editor.colorPicker).toBeNull();
		expect(t.editor.state.ink.kind).toBe('color');
		t.editor.key(key('right'));
		t.editor.key(key('space'));
		await t.renderOnce();

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
		t.editor.key(key('space'));
		t.editor.key(key('s', { ctrl: true }));
		await t.renderOnce();
		expect(existsSync(savePath)).toBe(true);
		expect(readFileSync(savePath, 'utf8')).toContain('--- idle');

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
		nowMs += 1000;
		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		expect(editor.colorPicker).toBeNull();

		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		editor.mouseDown({ button: 0, x: 1, y });
		editor.mouseUp();
		expect(editor.colorPicker).not.toBeNull();
	});

	test('idle time never recolors dynamic ink — p stays at the selected variant (spec #401 amendment)', async () => {
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

		expect(canvasHasBg(t.captureSpans(), hue(0), 6)).toBe(true);

		t.editor.tick(5000);
		await t.renderOnce();
		expect(canvasHasBg(t.captureSpans(), hue(0), 6)).toBe(true);

		expect(minInkColumn(t.captureSpans(), hue(1), 6)).toBe(-1);
	});

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
		const cell = variantCell(rows, 'p', 2);
		t.editor.mouseDown({ button: 0, x: cell.x, y: cell.y });
		t.editor.mouseUp();
		await t.renderOnce();
		const hue = (i: number): [number, number, number] => [
			HUES[i][0],
			HUES[i][1],
			HUES[i][2],
		];

		expect(minInkColumn(t.captureSpans(), hue(2), 6)).toBeGreaterThanOrEqual(
			RAIL_W,
		);

		expect(t.editor.state.history.past.length).toBe(0);
	});

	test('the variant rows live in the rail and only for dynamic-ink art; the canvas never shifts', async () => {
		const staticDoc = parseSpriteFile(
			'{"key": "g", "animations":[{"name":"idle"}]}\n--- idle\n▘·\n··\n',
			'stat2',
		).doc;
		if (!staticDoc) throw new Error('fixture failed to parse');
		const t1 = await mount({ doc: staticDoc, id: 'stat2', role: 'hat' });
		const rows1 = t1.captureCharFrame().split('\n');
		expect(rows1[0].slice(RAIL_W)).toContain('idle');
		expect(rows1.some((r) => / p \[\]/.test(r.slice(0, RAIL_W)))).toBe(false);

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
	const bx = RAIL_W;
	const by = 1;

	test('a left click-drag paints Pixels and coalesces into one undo step', async () => {
		const t = await mount({
			doc: emptySpriteDoc('m', 'hat'),
			id: 'm',
			role: 'hat',
		});
		t.editor.key(key('p'));

		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseDrag({ button: 0, x: bx + 2, y: by });
		t.editor.mouseUp();

		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
		expect(readPixel(t.editor.state, 1, 0)).toBe(true);

		expect(t.editor.state.history.past.length).toBe(1);
	});

	test('a drag keeps painting even when it does not re-report the button', async () => {
		const t = await mount({
			doc: emptySpriteDoc('drag', 'hat'),
			id: 'drag',
			role: 'hat',
		});
		t.editor.key(key('p'));

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
		t.editor.key(key('p'));
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseUp();
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);

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
		t.editor.key(key('p'));
		t.editor.zoom = 4;
		await t.renderOnce();

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
		t.editor.key(key('p'));
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
		t.editor.key(key('p'));
		t.editor.key(key('space'));
		t.editor.key(key('space'));
		t.editor.key(key('right', { shift: true }));
		expect(t.editor.state.float).not.toBeNull();
		t.editor.key(key('enter'));
		expect(t.editor.state.float).toBeNull();
		expect(t.editor.view).toBe('strips');
		t.editor.key(key('enter'));
		expect(t.editor.view).toBe('focus');
	});

	test('esc first clears a selection, then surfaces to strips', async () => {
		const t = await mount({
			doc: emptySpriteDoc('sel', 'hat'),
			id: 'sel',
			role: 'hat',
		});
		t.editor.key(key('1', { sequence: '1' }));
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseDrag({ button: 0, x: bx + 3, y: by + 1 });
		t.editor.mouseUp();
		expect(t.editor.state.selection).not.toBeNull();
		t.editor.key(key('tab'));
		expect(t.editor.view).toBe('focus');
		t.editor.key(key('escape'));
		expect(t.editor.state.selection).toBeNull();
		expect(t.editor.view).toBe('focus');
		t.editor.key(key('escape'));
		expect(t.editor.view).toBe('strips');
	});

	test('the shape gesture keeps claiming enter (anchor then commit, no view switch)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('shp', 'hat'),
			id: 'shp',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' }));
		t.editor.key(key('enter'));
		expect(t.editor.state.shape).not.toBeNull();
		expect(t.editor.view).toBe('strips');
		t.editor.key(key('right'));
		t.editor.key(key('enter'));
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
		const painted = t.editor.state.ink;
		t.editor.key(key('p'));
		t.editor.key(key('space'));
		t.editor.key(key('space'));
		t.editor.state = setInk(t.editor.state, TRANSPARENT_INK);
		t.editor.key(key('i'));
		expect(t.editor.state.ink).toEqual({ kind: 'transparent' });

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
		t.editor.key(key('p'));
		t.editor.mouseDown({ button: 0, x: bx, y: by });
		t.editor.mouseUp();
		t.editor.state = setInk(t.editor.state, TRANSPARENT_INK);
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, x: bx, y: by, modifiers: { alt: true } });
		t.editor.mouseUp();
		expect(t.editor.state.ink).toEqual(painted);
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
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

		t.editor.key(key('d'));
		t.editor.key(key('d'));
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(w0);
		t.editor.key(key('a'));
		t.editor.key(key('l'));
		t.editor.key(key('h'));
		t.editor.key(key('return'));
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

		await clickRail(t, /\bcanvas\b/);
		t.editor.key(key('d'));
		t.editor.key(key('return'));
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(w0 + 1);
		t.editor.key(key('u'));
		expect(t.editor.state.doc).toBe(before);

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
		t.editor.key(key('a'));
		await t.renderOnce();
		const frame = t.captureCharFrame();

		expect(frame).toContain('canvas 2×2 → 1×2');

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
		t.editor.key(key('a'));
		await t.renderOnce();

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

		// biome-ignore lint/suspicious/noExplicitAny: reach the private modal geom.
		const box = (t.editor as any).geom.canvasModal?.box as
			| { ox: number; oy: number; w: number; h: number }
			| undefined;
		if (!box) throw new Error('canvas modal geometry not recorded');

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

		expect(lit?.fg.slice(0, 3)).toEqual([10, 20, 30]);
		expect(lit?.bg.slice(0, 3)).toEqual([200, 100, 50]);

		const empty = cell(hit.x + 1, hit.y);
		expect(empty?.ch).toBe(' ');
		expect(empty?.bg.slice(0, 3)).not.toEqual([10, 20, 30]);
		expect(empty?.bg.slice(0, 3)).not.toEqual([200, 100, 50]);
	});

	test('a cell only a non-default frame inks: checkerboard unclipped, warning when clipped (no ghost, #411 QA)', async () => {
		const { doc } = parseSpriteFile(
			'{"animations":[{"name":"idle"},{"name":"sit"}],"colors":{"q":[10,20,30,255]}}\n--- idle\n█·\n··\n@colors\nq·\n··\n--- sit\n··\n·█\n@colors\n··\n·q\n',
			'ghost',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'ghost', role: 'hat' });
		await clickRail(t, /\bcanvas\b/);
		await t.renderOnce();
		// biome-ignore lint/suspicious/noExplicitAny: reach the private modal geom.
		const g = (t.editor as any).geom.canvasModal as {
			ox0: number;
			oy0: number;
			cw: number;
			ch: number;
		} | null;
		if (!g) throw new Error('canvas modal geometry not recorded');
		const cell = (
			cap: ReturnType<typeof t.captureSpans>,
			x: number,
			y: number,
		) => {
			let col = 0;
			for (const s of cap.lines[y].spans) {
				if (x < col + s.width)
					return { ch: s.text[x - col] ?? ' ', bg: s.bg.toInts() };
				col += s.width;
			}
			return null;
		};

		const sx = g.ox0 + 1 * g.cw;
		const sy = g.oy0 + 1 * g.ch;

		const before = cell(t.captureSpans(), sx, sy);
		expect(before?.ch).toBe(' ');
		expect(before?.bg.slice(0, 3)).not.toEqual([10, 20, 30]);
		expect(before?.bg.slice(0, 3)).not.toEqual([255, 180, 80]);

		t.editor.key(key('a'));
		await t.renderOnce();
		const after = cell(t.captureSpans(), sx, sy);
		expect(after?.bg.slice(0, 3)).toEqual([255, 180, 80]);
	});
});

describe('Sprite editor chrome (#392): rail, strips/focus, navigation, help', () => {
	function twoFrameDoc(): ReturnType<typeof emptySpriteDoc> {
		const frame = () => ({
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
			animations: [{ name: 'idle', frames: [frame(), frame()] }],
			colors: {},
		};
	}

	test('the left rail carries the tools row, ink list and the edit box', async () => {
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
		expect(rail).toContain('▚▚');

		expect(rail).toContain('edit');
		expect(rail).toContain('animation');
		expect(rail).toContain('canvas');
		expect(rail).not.toContain('◌ onion');
		expect(rail).not.toContain('✚ frame');
		expect(rail).not.toContain('playback');

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

		expect(frame).toContain('idle');
		expect(frame).toContain('‹ 5fps ›');

		const nameRow = frame.split('\n').find((l) => l.includes('◈frame 0'));
		expect(nameRow).toBeDefined();
		expect(nameRow).toContain('◈frame 0');
		expect(nameRow).toContain('frame 1');
	});

	test('clicking another frame activates it AND applies the tool (click-through)', async () => {
		const t = await mount({ doc: twoFrameDoc(), id: 'duo', role: 'hat' });
		t.editor.key(key('p'));
		expect(t.editor.state.frame).toBe('idle 0');

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

		expect(tabRow).toContain('frame 0 │ frame 1');

		const bCol = RAIL_W + tabRow.indexOf('1', tabRow.indexOf('│'));
		t.editor.mouseDown({ button: 0, x: bCol, y: 0 });
		expect(t.editor.state.frame).toBe('idle 1');
		t.editor.key(key('tab'));
		expect(t.editor.view).toBe('strips');
	});

	test('wheel scrolls the strips; ctrl-wheel zooms; middle-drag pans', async () => {
		const base = emptySpriteDoc('nav', 'form');

		const navDoc = {
			...base,
			animations: [
				...base.animations,
				{ name: 'jump', frames: [base.animations[0].frames[0]] },
			],
		};
		const t = await mount({ doc: navDoc, id: 'nav', role: 'form' });

		expect(t.captureCharFrame()).not.toContain('jump');
		t.editor.wheel({ button: 0, x: 40, y: 5, scroll: { direction: 'down' } });
		await t.renderOnce();

		for (let i = 0; i < 5; i++)
			t.editor.wheel({ button: 0, x: 40, y: 5, scroll: { direction: 'down' } });
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('jump');

		t.editor.mouseDown({ button: 1, x: 40, y: 2 });
		t.editor.mouseDrag({ button: 1, x: 40, y: 20 });
		t.editor.mouseUp();
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('idle ·');

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

		const walkFps = () =>
			t.editor.state.doc.animations.find((a) => a.name === 'walk')?.fps;
		const dec = find('‹');
		t.editor.mouseDown({ button: 0, x: dec.x, y: dec.y });
		t.editor.mouseUp();
		expect(walkFps()).toBe(4);

		for (let i = 0; i < 6; i++) {
			const d = find('‹');
			t.editor.mouseDown({ button: 0, x: d.x, y: d.y });
			t.editor.mouseUp();
			await t.renderOnce();
		}
		expect(walkFps()).toBe(1);

		const inc = find('›');
		t.editor.mouseDown({ button: 0, x: inc.x, y: inc.y });
		t.editor.mouseUp();
		expect(walkFps()).toBe(2);

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

		for (const k of ['h', 'j', 'k', 'l']) t.editor.key(key(k));
		expect(t.editor.state.cursor).toEqual({ x: 0, y: 0 });

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

		t.editor.key(key('space'));
		expect(t.editor.state.history.past.length).toBe(0);
		t.editor.key(key('escape'));
		expect(t.editor.helpOpen).toBe(false);
	});

	test('rail clicks switch tools, pick inks and cycle a control box button', async () => {
		const t = await mount({
			doc: emptySpriteDoc('click', 'hat'),
			id: 'click',
			role: 'hat',
			height: 34,
		});
		const lines = t.captureCharFrame().split('\n');
		const rowWith = (needle: string) =>
			lines.findIndex((l) => l.slice(0, RAIL_W).includes(needle));

		const toolY = rowWith('fill');
		t.editor.mouseDown({
			button: 0,
			x: lines[toolY].indexOf('fill'),
			y: toolY,
		});
		expect(t.editor.state.tool).toBe('fill');

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
		t.editor.key(key('1', { sequence: '1' }));

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

		expect(origin?.ch).toBe('·');

		expect(
			canvasHasBg(
				t.captureSpans(),
				[STANDARD_PALETTE.p[0], STANDARD_PALETTE.p[1], STANDARD_PALETTE.p[2]],
				10,
			),
		).toBe(false);

		expect(t.editor.state.shape?.tool).toBe('select');
		expect(t.editor.state.shape?.ink).toEqual(TRANSPARENT_INK);
	});
});

describe('Sprite editor shape tools (#394)', () => {
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
		t.editor.key(key('5', { sequence: '5' }));
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
		t.editor.key(key('6', { sequence: '6' }));
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 2) });
		await t.renderOnce();
		expect(t.editor.state.shape).not.toBeNull();
		expect(t.editor.state.doc).toBe(before);

		expect(canvasHasBg(t.captureSpans(), INK_P, 17)).toBe(true);
	});

	test('clicking the active rect tool button toggles outline↔filled (QA round 3: o is retired)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('o', 'hat'),
			id: 'o',
			role: 'hat',
		});
		t.editor.key(key('6', { sequence: '6' }));
		expect(t.editor.state.rectMode).toBe('outline');
		await clickRail(t, /\brect\b/);
		expect(t.editor.state.rectMode).toBe('filled');
		t.editor.key(key('o'));
		expect(t.editor.state.rectMode).toBe('filled');
	});

	test('keyboard click-click commits a shape over the same state', async () => {
		const t = await mount({
			doc: emptySpriteDoc('k', 'hat'),
			id: 'k',
			role: 'hat',
		});
		t.editor.key(key('5', { sequence: '5' }));
		t.editor.key(key('return'));
		for (let i = 0; i < 3; i++) t.editor.key(key('right'));
		expect(t.editor.state.shape).not.toBeNull();
		t.editor.key(key('return'));
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
		t.editor.key(key('5', { sequence: '5' }));
		const before = t.editor.state.doc;
		t.editor.mouseDown({ button: 0, ...at(0, 0) });
		t.editor.mouseDrag({ button: 0, ...at(3, 0) });
		t.editor.key(key('escape'));
		expect(t.editor.state.shape).toBeNull();
		expect(t.editor.state.doc).toBe(before);
	});
});

function hexToInts(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	];
}

describe('TUI opacity: no cell collapses to the terminal-default background (concern 1)', () => {
	const CLEAR = hexToInts(RENDERER_CLEAR_COLOR);

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
		t.editor.key(key('tab'));
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

						expect(inFrame).toBe(true);
						if (inFrame) checkerInFrame++;
					}
				col += s.width;
			}
		}

		expect(checkerInFrame).toBeGreaterThan(0);
	});
});

describe('focus filmstrip (post-#351)', () => {
	const WALK3 =
		'{"animations":[{"name":"walk"}]}\n' +
		'--- walk 0\n▘·\n··\n' +
		'--- walk 1\n▘·\n··\n' +
		'--- walk 2\n▘·\n··\n';

	async function mountWalk() {
		const { doc } = parseSpriteFile(WALK3, 'film');
		if (!doc) throw new Error('walk fixture failed to parse');
		const t = await mount({ doc, id: 'film', role: 'hat' });

		// biome-ignore lint/suspicious/noExplicitAny: set the private preview override.
		(t.editor as any).previewOverride = false;
		t.editor.key(key('tab'));
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

		const lit = bgAt(cap, active.x0, f.origin.y);
		const dim = bgAt(cap, neighbour.x0, f.origin.y);
		const sum = (c: number[]) => c[0] + c[1] + c[2];

		expect(sum(dim)).toBeLessThan(sum(lit));
		expect(sum(dim)).toBeGreaterThan(0);
	});

	test('the margins and inter-frame gaps stay the plain opaque surround', async () => {
		const t = await mountWalk();
		const f = focusGeom(t);
		const cap = t.captureSpans();

		const active = f.frames.find((b) => b.name === 'walk 0');
		if (!active) throw new Error('no active box');
		const gap = bgAt(cap, active.x1, f.origin.y);
		expect(gap).toEqual([16, 18, 26]);
	});

	test('← / → step the active frame under the launch-default select tool (no marquee)', async () => {
		const t = await mountWalk();

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

		t.editor.key(key('return'));
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
		t.editor.key(key('p'));
		expect(t.editor.state.frame).toBe('walk 0');
		t.editor.key(key('left'));
		expect(t.editor.state.frame).toBe('walk 2');
		t.editor.key(key('right'));
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

		t.editor.mouseDown({ button: 0, x: neighbour.x0 + 2, y: f.origin.y });
		t.editor.mouseUp();
		expect(t.editor.state.frame).toBe('walk 1');
		expect(t.editor.state.doc).toBe(before);
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
