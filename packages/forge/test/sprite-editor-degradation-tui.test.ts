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

function railText(frame: string): string {
	return frame
		.split('\n')
		.map((l) => l.slice(0, RAIL_W))
		.join('\n');
}

function wideTwoFrameDoc(): SpriteDoc {
	const frame = () => ({
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
		animations: [{ name: 'row', frames: [frame(), frame()] }],
		colors: {},
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
		expect(frame).toContain('70×20');

		expect(frame).not.toContain('tools');
	});

	test('recovers on resize with no data loss', async () => {
		const t = await mount({
			doc: emptySpriteDoc('keep', 'hat'),
			id: 'keep',
			role: 'hat',
			width: 100,
			height: 24,
		});
		t.editor.key(seq('p'));
		t.editor.key(seq('space'));
		t.editor.key(seq('space'));
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);

		t.resize(70, 20);
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('needs ≥80×24');
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);

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

		const paneShown = () =>
			t
				.captureCharFrame()
				.split('\n')
				.some((r) => r.slice(30).includes('preview'));
		expect(t.editor.composite).toBe(false);
		expect(paneShown()).toBe(false);

		t.resize(100, 24);
		await t.renderOnce();
		expect(t.editor.composite).toBe(true);
		expect(paneShown()).toBe(true);
	});

	test('the manual v override forces the pane visible while auto-hidden', async () => {
		const t = await mount({
			doc: emptySpriteDoc('pv2', 'hat'),
			id: 'pv2',
			role: 'hat',
			width: 80,
			height: 24,
		});
		expect(t.editor.composite).toBe(false);

		await t.renderOnce();
		const rows = t.captureCharFrame().split('\n');
		const y = rows.findIndex((r) => /\bpreview\b/.test(r.slice(0, 30)));
		if (y < 0) throw new Error('no preview button in the rail');
		const x = (/\bpreview\b/.exec(rows[y].slice(0, 30)) as RegExpExecArray)
			.index;
		t.editor.mouseDown({ button: 0, x: x + 1, y });
		t.editor.mouseUp();
		await t.renderOnce();
		expect(t.editor.composite).toBe(true);
		expect(
			t
				.captureCharFrame()
				.split('\n')
				.some((r) => r.slice(30).includes('preview')),
		).toBe(true);
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

		expect(t.editor.view).toBe('strips');

		const narrow = t.captureCharFrame();
		expect(narrow).toContain('frame 0 │ frame 1');
		expect(narrow).toContain('strips folded to focus');

		t.resize(160, 24);
		await t.renderOnce();
		const wide = t.captureCharFrame();

		expect(wide).toContain('row');
		expect(wide).not.toContain('strips folded to focus');
	});
});

describe('rung 3 — folded edit box (#398)', () => {
	test('the full edit box fits at the 80×24 floor; a huge palette folds it', async () => {
		const t = await mount({
			doc: emptySpriteDoc('fold', 'hat'),
			id: 'fold',
			role: 'hat',
			width: 80,
			height: 24,
		});
		const full = railText(t.captureCharFrame());
		expect(full).toContain('edit');
		expect(full).toContain('canvas');
		expect(full).toContain('preview');

		const colors = Object.fromEntries(
			Array.from({ length: 90 }, (_, i) => [
				String.fromCharCode(0x0100 + i),
				[i, i, i, 255] as [number, number, number, number],
			]),
		);
		const bigDoc = {
			...emptySpriteDoc('fold2', 'hat'),
			colors,
		} as ReturnType<typeof emptySpriteDoc>;
		const t2 = await mount({
			doc: bigDoc,
			id: 'fold2',
			role: 'hat',
			width: 80,
			height: 24,
		});
		const folded = railText(t2.captureCharFrame());

		expect(folded).toContain('animation');
		expect(folded).not.toContain('canvas');
		expect(folded).not.toContain('preview');
		t2.resize(80, 45);
		await t2.renderOnce();
		expect(railText(t2.captureCharFrame())).toContain('canvas');
	});
});
