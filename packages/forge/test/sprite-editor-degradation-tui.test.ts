import { describe, expect, test } from 'bun:test';
import { parseSpriteFile } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';

const key = (name: string, extra: Partial<SpriteKey> = {}): SpriteKey => ({
	name,
	sequence: extra.sequence ?? '',
	...extra,
});

async function mount(width: number, height: number) {
	const saved: string[] = [];
	const t = await createTestRenderer({ width, height });
	const editor = new SpriteEditor(t.renderer, {
		id: 'adaptive',
		role: 'hat',
		doc: emptySpriteDoc('adaptive', 'hat'),
		save: (text) => saved.push(text),
	});
	editor.attach(t.renderer.root);
	await t.renderOnce();
	return { ...t, editor, saved };
}

describe('Sprite editor terminal degradation', () => {
	test('art survives a below-floor resize and is still saveable after recovery', async () => {
		const t = await mount(100, 24);
		t.editor.key(key('p'));
		t.editor.key(key('space'));
		t.editor.key(key('space'));

		t.resize(70, 20);
		await t.renderOnce();
		t.resize(100, 24);
		await t.renderOnce();

		t.editor.key(key('s', { ctrl: true }));
		const parsed = parseSpriteFile(t.saved.at(-1) ?? '', 'adaptive');
		expect(parsed.doc?.animations[0]?.frames[0]?.rows[0]?.[0]).not.toBe(' ');
	});
});
