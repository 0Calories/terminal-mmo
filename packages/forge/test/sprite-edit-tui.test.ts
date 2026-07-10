// Thin chrome smoke tests for the Sprite editor TUI. Logic is covered
// headlessly in sprite-editor-state/view/picker tests; these only assert the
// Renderable draws the right thing and keys reach the pure ops.
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
import { parseSpriteFile } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';

const key = (name: string, extra: Partial<SpriteKey> = {}): SpriteKey => ({
	name,
	sequence: extra.sequence ?? '',
	...extra,
});

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
}) {
	const t = await createTestRenderer({ width: 100, height: 20 });
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
	test('opens an existing sprite and renders its frame art', async () => {
		// A tiny hat with one lit quadrant (▘) in the idle frame.
		const text = '--- idle\n▘·\n··\n';
		const { doc } = parseSpriteFile(text, 'cap');
		if (!doc) throw new Error('fixture failed to parse');
		const { captureCharFrame, editor } = await mount({
			doc,
			id: 'cap',
			role: 'hat',
		});
		const frame = captureCharFrame();
		expect(frame).toContain('cap');
		expect(frame).toContain('(hat)');
		// The art glyph is on the canvas.
		expect(frame).toContain('▘');
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

	test('a paint keystroke lights a pixel on the canvas', async () => {
		const t = await mount({
			doc: emptySpriteDoc('draw', 'hat'),
			id: 'draw',
			role: 'hat',
		});
		// A full block '█' is unambiguous (never a cursor quadrant marker).
		expect(t.captureCharFrame()).not.toContain('█');
		// Paint all four quadrants of cell (0,0) as one pen stroke.
		t.editor.key(key('space')); // pen down, TL
		t.editor.key(key('right')); // TR
		t.editor.key(key('down')); // BR
		t.editor.key(key('left')); // BL
		t.editor.key(key('space')); // lift pen
		// Move the cursor off the painted cell so its marker doesn't cover the art.
		for (let i = 0; i < 6; i++) t.editor.key(key('right'));
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('█');
	});

	test('a refused paint surfaces feedback in the frame', async () => {
		const t = await mount({
			doc: emptySpriteDoc('bad', 'hat'),
			id: 'bad',
			role: 'hat',
		});
		// Paint one pixel with fg 'p'.
		t.editor.key(key('space'));
		t.editor.key(key('space')); // lift pen
		// Switch fg to a different key, move to the other TR quadrant, paint → refused.
		t.editor.key(key('f')); // open fg picker
		// Navigate to the 'm' palette entry (any non-'p' key) and pick it.
		// Simpler: type a new local color 'z'.
		// Move to the "+ new" row and define a color.
		// Instead, drive setFgKey via picker: choose an existing global entry.
		// Move down to first non-current entry and choose it.
		t.editor.key(key('down'));
		t.editor.key(key('enter'));
		expect(t.editor.picker).toBeNull();
		t.editor.key(key('right')); // move to TR quadrant of same cell
		t.editor.key(key('space')); // paint with a different color → refused
		await t.renderOnce();
		const frame = t.captureCharFrame();
		expect(t.editor.state.feedback).not.toBe('');
		expect(frame).toContain('⚠');
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
