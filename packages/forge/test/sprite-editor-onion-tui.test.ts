// Headless render tests for onion skinning (spec #387, issue #396). The pure
// sourcing is covered in sprite-editor-onion.test.ts; here we drive the fatbits
// Renderable and assert from the rendered buffer that ghosts show through the
// active Frame's transparency in the right tints, replace the checkerboard only
// where a neighbour lights a Pixel, and vanish during playback.
import { describe, expect, test } from 'bun:test';
import type { SpriteDoc, SpriteFrameDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { RAIL_W } from '../src/sprite-editor/chrome';
import { ghostColor } from '../src/sprite-editor/onion';
import {
	initSpriteEditor,
	paintPixel,
	selectFrame,
} from '../src/sprite-editor/state';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';

const key = (name: string, extra: Partial<SpriteKey> = {}): SpriteKey => ({
	name,
	sequence: extra.sequence ?? '',
	...extra,
});

// The editor's canvas background (C.bg), the colour ghosts blend over.
const CANVAS_BG: [number, number, number, number] = [16, 18, 26, 255];
const PREV = ghostColor('prev', 1, CANVAS_BG);
const NEXT = ghostColor('next', 1, CANVAS_BG);

function blank(name: string, w = 4, h = 4): SpriteFrameDoc {
	const rows = Array.from({ length: h }, () => ' '.repeat(w));
	return { name, rows, colors: rows.slice(), bg: rows.slice(), anchors: {} };
}

// A 3-Frame 'run' animation: f0 lights Pixel (0,0), f2 lights Pixel (2,0); the middle
// Frame f1 (the one we edit) is fully transparent, so its neighbours ghost
// straight through it.
function animDoc(): SpriteDoc {
	const base: SpriteDoc = {
		id: 'anim',
		key: 'p',
		baseline: 0,
		anchors: {},
		animations: { run: ['f0', 'f1', 'f2'] },
		fps: {},
		colors: {} as SpriteDoc['colors'],
		frames: [blank('f0'), blank('f1'), blank('f2')],
	};
	// Paint through the pure state ops so the grids are real art.
	let s = initSpriteEditor(base, 'f0');
	s = paintPixel(s, 0, 0); // f0: Pixel (0,0)
	s = selectFrame(s, 'f2');
	s = paintPixel(s, 2, 0); // f2: Pixel (2,0)
	return s.doc;
}

async function mount(view: 'strips' | 'focus') {
	const t = await createTestRenderer({ width: 100, height: 24 });
	const editor = new SpriteEditor(t.renderer, {
		id: 'anim',
		role: 'form',
		doc: animDoc(),
		frame: 'f1',
		save: () => {},
	});
	editor.attach(t.renderer.root);
	if (view === 'focus') editor.key(key('tab'));
	await t.renderOnce();
	return { ...t, editor };
}

type Spans = ReturnType<
	Awaited<ReturnType<typeof createTestRenderer>>['captureSpans']
>;

// Whether the canvas region (right of the rail, above the chrome) has any cell
// whose background exactly matches `rgb`.
function canvasHasBg(cap: Spans, rgb: readonly number[]): boolean {
	for (let y = 0; y < cap.lines.length - 2; y++) {
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

describe('onion skinning — ghosts through the active Frame', () => {
	test('depth 0 (default) shows no ghosts, only the checkerboard', async () => {
		const t = await mount('focus');
		expect(t.editor.onionDepth).toBe(0);
		expect(canvasHasBg(t.captureSpans(), PREV)).toBe(false);
		expect(canvasHasBg(t.captureSpans(), NEXT)).toBe(false);
	});

	test('O cycles depth and the previous/next neighbours ghost red/blue (focus)', async () => {
		const t = await mount('focus');
		t.editor.key(key('O', { sequence: 'O' })); // depth → 1
		expect(t.editor.onionDepth).toBe(1);
		await t.renderOnce();
		const cap = t.captureSpans();
		// f0 (previous) shows red through f1's transparency; f2 (next) shows blue.
		expect(canvasHasBg(cap, PREV)).toBe(true);
		expect(canvasHasBg(cap, NEXT)).toBe(true);
	});

	test('ghosts also render in the strips view', async () => {
		const t = await mount('strips');
		t.editor.key(key('O', { sequence: 'O' }));
		await t.renderOnce();
		const cap = t.captureSpans();
		expect(canvasHasBg(cap, PREV)).toBe(true);
		expect(canvasHasBg(cap, NEXT)).toBe(true);
	});

	test('playback suspends the ghosts', async () => {
		const t = await mount('focus');
		t.editor.key(key('O', { sequence: 'O' })); // onion on
		t.editor.key(key('.', { sequence: '.' })); // play the animation
		await t.renderOnce();
		const cap = t.captureSpans();
		expect(canvasHasBg(cap, PREV)).toBe(false);
		expect(canvasHasBg(cap, NEXT)).toBe(false);
	});

	test('O wraps 0 → 1 → 2 → 0', async () => {
		const t = await mount('focus');
		const press = () => t.editor.key(key('O', { sequence: 'O' }));
		press();
		expect(t.editor.onionDepth).toBe(1);
		press();
		expect(t.editor.onionDepth).toBe(2);
		press();
		expect(t.editor.onionDepth).toBe(0);
	});
});
