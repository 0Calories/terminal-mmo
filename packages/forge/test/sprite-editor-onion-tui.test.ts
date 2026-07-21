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

function blank(w = 4, h = 4): SpriteFrameDoc {
	const rows = Array.from({ length: h }, () => ' '.repeat(w));
	return { rows, colors: rows.slice(), bg: rows.slice(), anchors: {} };
}

// A 3-Frame 'run' animation: frame 'run 0' lights Pixel (0,0), 'run 2' lights
// Pixel (2,0); the middle Frame 'run 1' (the one we edit) is fully transparent,
// so its neighbours ghost straight through it.
function animDoc(): SpriteDoc {
	const base: SpriteDoc = {
		id: 'anim',
		key: 'p',
		baseline: 0,
		anchors: {},
		animations: [{ name: 'run', frames: [blank(), blank(), blank()] }],
		colors: {} as SpriteDoc['colors'],
	};
	// Paint through the pure state ops so the grids are real art.
	let s = initSpriteEditor(base, 'run 0');
	s = paintPixel(s, 0, 0); // run 0: Pixel (0,0)
	s = selectFrame(s, 'run 2');
	s = paintPixel(s, 2, 0); // run 2: Pixel (2,0)
	return s.doc;
}

async function mount(view: 'strips' | 'focus') {
	const t = await createTestRenderer({ width: 100, height: 24 });
	const editor = new SpriteEditor(t.renderer, {
		id: 'anim',
		role: 'form',
		doc: animDoc(),
		frame: 'run 1',
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

describe('onion skinning — a prev-frame ghost in the focus view (round 3)', () => {
	test('off by default shows no ghost, only the checkerboard', async () => {
		const t = await mount('focus');
		expect(t.editor.onion).toBe(false);
		expect(canvasHasBg(t.captureSpans(), PREV)).toBe(false);
		expect(canvasHasBg(t.captureSpans(), NEXT)).toBe(false);
	});

	test('onion on ghosts ONLY the previous frame (red), never the next', async () => {
		const t = await mount('focus');
		t.editor.onion = true;
		await t.renderOnce();
		const cap = t.captureSpans();
		// run 1's previous frame is run 0 (red ghost); the next frame no longer ghosts.
		expect(canvasHasBg(cap, PREV)).toBe(true);
		expect(canvasHasBg(cap, NEXT)).toBe(false);
	});

	test('the effect is confined to the focus view — strips never ghosts', async () => {
		const t = await mount('strips');
		t.editor.onion = true;
		await t.renderOnce();
		const cap = t.captureSpans();
		expect(canvasHasBg(cap, PREV)).toBe(false);
		expect(canvasHasBg(cap, NEXT)).toBe(false);
	});

	test('playback suspends the ghost', async () => {
		const t = await mount('focus');
		t.editor.onion = true;
		// Play moved off the rail to the preview pane (post-#351); drive it directly.
		// biome-ignore lint/suspicious/noExplicitAny: reach the private playback toggle.
		(t.editor as any).togglePlay('animation');
		await t.renderOnce();
		expect(canvasHasBg(t.captureSpans(), PREV)).toBe(false);
	});

	test('the tab-row onion toggle flips it on and off', async () => {
		const t = await mount('focus');
		expect(t.editor.onion).toBe(false);
		await t.renderOnce();
		// biome-ignore lint/suspicious/noExplicitAny: reach the private focus geometry.
		const ot = (t.editor as any).geom.focus.onionToggle as {
			x0: number;
			y: number;
		} | null;
		if (!ot) throw new Error('no onion toggle on the tab row');
		t.editor.mouseDown({ button: 0, x: ot.x0, y: ot.y });
		t.editor.mouseUp();
		expect(t.editor.onion).toBe(true);
	});
});
