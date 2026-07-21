// Chrome smoke tests for the Composited preview (issues #340, #393): the editor's
// always-on floating pane. The composition math is covered pixel-exactly in
// sprite-composite.test.ts; these assert the keys reach the pure ops and the
// Renderables draw the right thing. (The standalone `forge sprite preview` TUI
// died in #386 — the headless surface is `sprite render --composite`, covered
// in sprite-cli.test.ts.)

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpriteFile, type SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { SPRITE_KEYMAP } from '../src/sprite-editor/chrome';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';

const seq = (s: string): SpriteKey => ({ name: s, sequence: s });

function loadDoc(rel: string, id: string): SpriteDoc {
	const text = readFileSync(join(import.meta.dir, '../../..', rel), 'utf8');
	const { doc } = parseSpriteFile(text, id);
	if (!doc) throw new Error(`could not parse ${rel}`);
	return doc;
}

describe('editor floating preview pane', () => {
	async function mountEditor(doc: SpriteDoc, role: 'form' | 'weapon' | 'hat') {
		const t = await createTestRenderer({ width: 100, height: 24 });
		const editor = new SpriteEditor(t.renderer, {
			id: doc.id,
			role,
			doc,
			save: () => {},
		});
		editor.attach(t.renderer.root);
		await t.renderOnce();
		return { ...t, editor };
	}

	// Whether the floating pane renders: its bordered ' preview ' title shows in
	// the canvas region (right of the rail — the rail's own 'preview' button
	// always shows and must not count).
	function paneShown(t: Awaited<ReturnType<typeof mountEditor>>): boolean {
		return t
			.captureCharFrame()
			.split('\n')
			.some((r) => r.slice(30).includes('preview'));
	}

	// Click the rail's preview toggle button (QA round 3: the v key died).
	async function clickPreviewButton(
		t: Awaited<ReturnType<typeof mountEditor>>,
	): Promise<void> {
		await t.renderOnce();
		const rows = t.captureCharFrame().split('\n');
		for (let y = 0; y < rows.length; y++) {
			const m = /\bpreview\b/.exec(rows[y].slice(0, 30));
			if (m) {
				t.editor.mouseDown({ button: 0, x: m.index + 1, y });
				t.editor.mouseUp();
				return;
			}
		}
		throw new Error('no preview button in the rail');
	}

	test('the preview is on by default and the rail button toggles it off/on (#393, QA round 3)', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		// Always-on: the pane and its controls render without any keypress.
		expect(t.editor.composite).toBe(true);
		expect(paneShown(t)).toBe(true);
		// The rail button is the degradation override: toggling off drops the pane.
		await clickPreviewButton(t);
		expect(t.editor.composite).toBe(false);
		await t.renderOnce();
		expect(paneShown(t)).toBe(false);
		// And back on.
		await clickPreviewButton(t);
		expect(t.editor.composite).toBe(true);
		await t.renderOnce();
		expect(paneShown(t)).toBe(true);
	});

	test('the pane carries flip + play controls', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		const frame = t.captureCharFrame();
		expect(frame).toContain('flip');
		expect(frame).toContain('play');
	});

	test('turning the pane off changes the rendered frame', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		const on = t.captureCharFrame();
		await clickPreviewButton(t);
		await t.renderOnce();
		const off = t.captureCharFrame();
		// Dropping the floating pane (avatar art + border) changes the frame.
		expect(off).not.toBe(on);
	});

	// The pane docks top-right at a fixed native size (PREVIEW_W=34), so at 100×24
	// its bottom control row sits at y=10 and its controls start at x=68 (`flip …`)
	// / x=76 (`▶ play`) — mirroring renderPreviewPane's layout.
	const CONTROL_ROW = 10;
	const FLIP_X = 69;
	const PLAY_X = 78;

	test('clicking the pane flip control flips the preview facing (mouse-clickable)', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		expect(t.editor.previewFacing).toBe(1);
		t.editor.mouseDown({ button: 0, x: FLIP_X, y: CONTROL_ROW });
		expect(t.editor.previewFacing).toBe(-1);
	});

	test('clicking the pane play control toggles animation playback (mouse-clickable)', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		expect(t.editor.playMode).toBe('none');
		t.editor.mouseDown({ button: 0, x: PLAY_X, y: CONTROL_ROW });
		expect(t.editor.playMode).toBe('animation');
	});

	test('a click on the pane body is swallowed — it never paints the canvas beneath', async () => {
		const t = await mountEditor(
			loadDoc('sprites/hats/wizard.sprite', 'wizard'),
			'hat',
		);
		const before = t.editor.state;
		// Interior of the floating pane (top-right), above the control row.
		t.editor.mouseDown({ button: 0, x: 80, y: 4 });
		t.editor.mouseUp();
		expect(t.editor.state).toBe(before);
	});

	test('the key map documents the preview toggle as a rail button (QA round 3)', () => {
		const bindings = SPRITE_KEYMAP.flatMap((g) => g.bindings);
		// The preview toggle lives on the rail's `edit` box (round 3).
		expect(
			bindings.some(
				(b) => b.keys === 'edit box' && b.label.includes('preview'),
			),
		).toBe(true);
		// No v binding survives.
		expect(bindings.some((b) => b.keys === 'v')).toBe(false);
	});
});
