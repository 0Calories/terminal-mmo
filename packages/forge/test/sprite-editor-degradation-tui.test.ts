// Headless render tests for the small-terminal degradation ladder (spec #398):
// the ≥80×24 placard (live size + recovery with no data loss), the preview
// auto-hide + manual override, the strips→focus force, and the folded playback
// box. `@opentui/core/testing` drives the editor Renderable at fixed terminal
// sizes and `resize()` walks it through the rungs; the pure trigger/reversal
// logic is covered in sprite-editor-degradation.test.ts.
import { describe, expect, test } from 'bun:test';
import type { SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { RAIL_W } from '../src/sprite-editor/chrome';
import { readPixel } from '../src/sprite-editor/state';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';

const seq = (s: string): SpriteKey => ({ name: s, sequence: s });

async function mount(opts: {
	doc: SpriteDoc;
	id: string;
	role: 'form' | 'weapon' | 'hat' | 'monster' | 'npc';
	width: number;
	height: number;
}) {
	const t = await createTestRenderer({
		width: opts.width,
		height: opts.height,
	});
	const editor = new SpriteEditor(t.renderer, {
		id: opts.id,
		role: opts.role,
		doc: opts.doc,
		save: () => {},
	});
	editor.attach(t.renderer.root);
	await t.renderOnce();
	return { ...t, editor };
}

// The rail region (left 30 columns) of the captured frame.
function railText(frame: string): string {
	return frame
		.split('\n')
		.map((l) => l.slice(0, RAIL_W))
		.join('\n');
}

// A doc with two Frames wide enough (12 cells) that two never fit at ×2 in a
// narrow terminal — the rung-2 force-focus trigger.
function wideTwoFrameDoc(): SpriteDoc {
	const frame = (name: string) => ({
		name,
		rows: [' '.repeat(12), ' '.repeat(12)],
		colors: [' '.repeat(12), ' '.repeat(12)],
		bg: [' '.repeat(12), ' '.repeat(12)],
		anchors: {},
	});
	return {
		id: 'wide',
		key: 'p',
		baseline: 0,
		anchors: {},
		poses: { row: ['aa', 'bb'] },
		fps: {},
		colors: {},
		frames: [frame('aa'), frame('bb')],
	};
}

describe('below-floor placard (#398)', () => {
	test('shows a live centred placard instead of the editor, and never mentions the rail', async () => {
		const t = await mount({
			doc: emptySpriteDoc('tiny', 'hat'),
			id: 'tiny',
			role: 'hat',
			width: 70,
			height: 20,
		});
		const frame = t.captureCharFrame();
		expect(frame).toContain('sprite editor needs ≥80×24');
		expect(frame).toContain('70×20'); // live current size
		// The editor UI is gone — the rail's 'tools' box is not drawn.
		expect(frame).not.toContain('tools');
	});

	test('recovers on resize with no data loss', async () => {
		// Paint a Pixel at a valid size first.
		const t = await mount({
			doc: emptySpriteDoc('keep', 'hat'),
			id: 'keep',
			role: 'hat',
			width: 100,
			height: 24,
		});
		t.editor.key(seq('space')); // paint at cursor (0,0)
		t.editor.key(seq('space')); // lift pen
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);

		// Shrink below the floor: the placard replaces the UI, but the art survives.
		t.resize(70, 20);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('needs ≥80×24');
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);

		// Grow back: the editor returns instantly and the art is still there.
		t.resize(100, 24);
		await t.renderOnce();
		const back = t.captureCharFrame();
		expect(back).toContain('tools');
		expect(back).not.toContain('needs ≥80×24');
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);
	});
});

describe('rung 1 — preview auto-hide + override (#398)', () => {
	test('auto-hides at the narrow floor and returns when the terminal widens', async () => {
		const t = await mount({
			doc: emptySpriteDoc('pv', 'hat'),
			id: 'pv',
			role: 'hat',
			width: 80,
			height: 24,
		});
		// At 80 wide the float would cover more than half — auto-hidden.
		expect(t.editor.composite).toBe(false);
		expect(t.captureCharFrame()).not.toContain('preview');

		// Widen: the pane comes back on its own (reversible).
		t.resize(100, 24);
		await t.renderOnce();
		expect(t.editor.composite).toBe(true);
		expect(t.captureCharFrame()).toContain('preview');
	});

	test('the manual v override forces the pane visible while auto-hidden', async () => {
		const t = await mount({
			doc: emptySpriteDoc('pv2', 'hat'),
			id: 'pv2',
			role: 'hat',
			width: 80,
			height: 24,
		});
		expect(t.editor.composite).toBe(false); // auto-hidden at the floor
		t.editor.key(seq('v')); // force it visible
		await t.renderOnce();
		expect(t.editor.composite).toBe(true);
		expect(t.captureCharFrame()).toContain('preview');
	});
});

describe('rung 2 — strips force focus (#398)', () => {
	test('narrow: renders the focus tab row and a status hint; wide: renders strips', async () => {
		const t = await mount({
			doc: wideTwoFrameDoc(),
			id: 'wide',
			role: 'hat',
			width: 80,
			height: 24,
		});
		// The user never left strips…
		expect(t.editor.view).toBe('strips');
		// …but two wide Frames don't fit, so focus is rendered: its tab row shows
		// the Frame names, and the hint line explains the fold.
		const narrow = t.captureCharFrame();
		expect(narrow).toContain('aa │ bb');
		expect(narrow).toContain('strips folded to focus');

		// A wide terminal fits both Frames — strips return (the pose label shows).
		t.resize(160, 24);
		await t.renderOnce();
		const wide = t.captureCharFrame();
		expect(wide).toContain('row · 2f'); // the strip's pose label
		expect(wide).not.toContain('strips folded to focus');
	});
});

describe('rung 3 — folded playback box (#398)', () => {
	test('folds to one hint row at the floor and unfolds when the terminal grows tall', async () => {
		const t = await mount({
			doc: emptySpriteDoc('fold', 'hat'),
			id: 'fold',
			role: 'hat',
			width: 80,
			height: 24,
		});
		// Folded: the box collapses to a single 'playback' hint; its full-box
		// controls (', walk', 'pose idle') are gone, but the rail itself stays.
		const folded = railText(t.captureCharFrame());
		expect(folded).toContain('playback');
		expect(folded).not.toContain(', walk');

		// Grow tall: the full playback box returns with its detail (reversible).
		t.resize(80, 40);
		await t.renderOnce();
		const full = railText(t.captureCharFrame());
		expect(full).toContain(', walk');
		expect(full).toContain('pose idle');
	});
});
