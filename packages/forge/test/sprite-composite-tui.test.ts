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

	test('the preview is on by default and v toggles it off/on (#393)', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		// Always-on: the pane and its controls render without any keypress.
		expect(t.editor.composite).toBe(true);
		expect(t.captureCharFrame()).toContain('preview');
		// `v` is the rare degradation override: toggling off drops the pane.
		t.editor.key(seq('v'));
		expect(t.editor.composite).toBe(false);
		await t.renderOnce();
		const off = t.captureCharFrame();
		expect(off).not.toContain('preview');
		// And back on.
		t.editor.key(seq('v'));
		expect(t.editor.composite).toBe(true);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('preview');
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
		t.editor.key(seq('v'));
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

	test('clicking the pane play control toggles pose playback (mouse-clickable)', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		expect(t.editor.playMode).toBe('none');
		t.editor.mouseDown({ button: 0, x: PLAY_X, y: CONTROL_ROW });
		expect(t.editor.playMode).toBe('pose');
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

	test('the key map documents the preview toggle on v (locked keymap #387)', () => {
		const bindings = SPRITE_KEYMAP.flatMap((g) => g.bindings);
		const v = bindings.find((b) => b.keys === 'v');
		expect(v?.label.toLowerCase()).toContain('preview');
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
		expect(frame).toContain('[ ] pose');
	});

	test('[ and ] switch pose/phase', async () => {
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
	test('reload swaps the doc and preserves the selected pose when it survives', async () => {
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

	test('preservedStanceIndex falls back to 0 when the pose vanished', () => {
		const doc = loadDoc('sprites/forms/buddy.sprite', 'buddy');
		const stances = previewStances(doc, 'form');
		expect(preservedStanceIndex(stances, stances[1]?.id)).toBe(1);
		expect(preservedStanceIndex(stances, 'emote:gone')).toBe(0);
		expect(preservedStanceIndex(stances, undefined)).toBe(0);
	});
});
