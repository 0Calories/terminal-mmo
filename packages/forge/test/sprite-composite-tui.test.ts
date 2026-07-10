// Chrome smoke tests for the Composited preview (issue #340): the editor's `o`
// panel and the standalone `forge sprite preview` TUI. The composition math is
// covered pixel-exactly in sprite-composite.test.ts; these assert the keys reach
// the pure ops and the Renderables draw the right thing.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpriteFile, type SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { previewStances } from '../src/sprite-editor/composite';
import {
	preservedStanceIndex,
	SpritePreview,
} from '../src/sprite-editor/preview';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';
import { spriteHelpLine } from '../src/sprite-editor/view';

const seq = (s: string): SpriteKey => ({ name: s, sequence: s });

function loadDoc(rel: string, id: string): SpriteDoc {
	const text = readFileSync(join(import.meta.dir, '../../..', rel), 'utf8');
	const { doc } = parseSpriteFile(text, id);
	if (!doc) throw new Error(`could not parse ${rel}`);
	return doc;
}

describe('editor o panel', () => {
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

	test('o toggles the in-context panel on and off', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		expect(t.editor.composite).toBe(false);
		t.editor.key(seq('o'));
		expect(t.editor.composite).toBe(true);
		await t.renderOnce();
		// The panel splits the screen with a divider column not present otherwise.
		expect(t.captureCharFrame()).toContain('│');
		t.editor.key(seq('o'));
		expect(t.editor.composite).toBe(false);
	});

	test('the panel composites the WIP body (real art glyphs render)', async () => {
		const t = await mountEditor(
			loadDoc('sprites/forms/buddy.sprite', 'buddy'),
			'form',
		);
		const before = t.captureCharFrame();
		t.editor.key(seq('o'));
		await t.renderOnce();
		const after = t.captureCharFrame();
		// Turning the panel on changes the frame (avatar art drawn on the right).
		expect(after).not.toBe(before);
	});

	test('help line advertises the in-context toggle', () => {
		expect(spriteHelpLine()).toContain('o in-context');
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
