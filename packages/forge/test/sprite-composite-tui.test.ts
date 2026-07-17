// Chrome smoke tests for the Composited preview (issues #340, #393): the editor's
// always-on floating pane and the standalone `forge sprite preview` TUI. The
// composition math is covered pixel-exactly in sprite-composite.test.ts; these
// assert the keys reach the pure ops and the Renderables draw the right thing.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpriteFile, type SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { SPRITE_KEYMAP } from '../src/sprite-editor/chrome';
import { previewStances } from '../src/sprite-editor/composite';
import {
	preservedStanceIndex,
	SpritePreview,
} from '../src/sprite-editor/preview';
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
		expect(
			bindings.some((b) => b.keys === 'buttons' && b.label.includes('preview')),
		).toBe(true);
		// No v binding survives.
		expect(bindings.some((b) => b.keys === 'v')).toBe(false);
	});
});

describe('forge sprite preview TUI', () => {
	async function mountPreview(doc: SpriteDoc, role: 'form' | 'weapon' | 'hat') {
		const t = await createTestRenderer({ width: 80, height: 24 });
		const preview = new SpritePreview(t.renderer, { id: doc.id, role, doc });
		preview.attach(t.renderer.root);
		await t.renderOnce();
		return { ...t, preview };
	}

	test('mounts and shows the status + help chrome', async () => {
		const t = await mountPreview(
			loadDoc('sprites/weapons/sword.sprite', 'sword'),
			'weapon',
		);
		const frame = t.captureCharFrame();
		expect(frame).toContain('sword');
		expect(frame).toContain('[ ] animation');
	});

	test('[ and ] switch animation/phase', async () => {
		const t = await mountPreview(
			loadDoc('sprites/weapons/sword.sprite', 'sword'),
			'weapon',
		);
		expect(t.preview.stanceId).toBe('idle');
		t.preview.key(seq(']'));
		expect(t.preview.stanceId).toBe('windup');
		t.preview.key(seq('['));
		expect(t.preview.stanceId).toBe('idle');
		// wraps backwards to the last phase the doc actually declares.
		const stances = previewStances(
			loadDoc('sprites/weapons/sword.sprite', 'sword'),
			'weapon',
		);
		t.preview.key(seq('['));
		expect(t.preview.stanceId).toBe(stances[stances.length - 1].id);
	});

	test('. starts playback and deterministic ticks advance the clock', async () => {
		const t = await mountPreview(
			loadDoc('sprites/weapons/sword.sprite', 'sword'),
			'weapon',
		);
		expect(t.preview.view().elapsedS).toBe(0);
		t.preview.key(seq('.'));
		expect(t.preview.playing).toBe(true);
		t.preview.tick(500);
		expect(t.preview.view().elapsedS).toBeCloseTo(0.5, 5);
		// A paused preview ignores ticks.
		t.preview.key(seq('.'));
		expect(t.preview.playing).toBe(false);
		t.preview.tick(500);
		expect(t.preview.view().elapsedS).toBe(0);
	});

	test('m flips facing', async () => {
		const t = await mountPreview(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		expect(t.preview.facing).toBe(1);
		t.preview.key(seq('m'));
		expect(t.preview.facing).toBe(-1);
	});
});

describe('reload on save', () => {
	test('reload swaps the doc and preserves the selected animation when it survives', async () => {
		const doc = loadDoc('sprites/weapons/sword.sprite', 'sword');
		const t = await createTestRenderer({ width: 80, height: 24 });
		const preview = new SpritePreview(t.renderer, {
			id: 'sword',
			role: 'weapon',
			doc,
		});
		preview.key(seq(']')); // select 'windup'
		expect(preview.stanceId).toBe('windup');

		// A save lands: the same doc reparsed. The selection survives.
		const reparsed = loadDoc('sprites/weapons/sword.sprite', 'sword');
		preview.reload(reparsed, null);
		expect(preview.doc).toBe(reparsed);
		expect(preview.stanceId).toBe('windup');
	});

	test('reload with a parse error keeps the last-good doc and surfaces the error', async () => {
		const doc = loadDoc('sprites/forms/buddy.sprite', 'buddy');
		const t = await createTestRenderer({ width: 80, height: 24 });
		const preview = new SpritePreview(t.renderer, {
			id: 'buddy',
			role: 'form',
			doc,
		});
		preview.reload(null, 'boom');
		expect(preview.doc).toBe(doc);
		expect(preview.parseError).toBe('boom');
	});

	test('preservedStanceIndex falls back to 0 when the animation vanished', () => {
		const doc = loadDoc('sprites/forms/buddy.sprite', 'buddy');
		const stances = previewStances(doc, 'form');
		expect(preservedStanceIndex(stances, stances[1]?.id)).toBe(1);
		expect(preservedStanceIndex(stances, 'emote:gone')).toBe(0);
		expect(preservedStanceIndex(stances, undefined)).toBe(0);
	});
});
