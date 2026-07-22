import { describe, expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import {
	RAIL_W,
	type RailAction,
	type RailRow,
} from '../src/sprite-editor/chrome';
import {
	currentFrame,
	frameExtent,
	readPixel,
} from '../src/sprite-editor/state';
import {
	emptySpriteDoc,
	type SpriteRole,
} from '../src/sprite-editor/templates';
import {
	RENDERER_CLEAR_COLOR,
	SpriteEditor,
	type SpriteKey,
} from '../src/sprite-editor/tui';

const key = (name: string, extra: Partial<SpriteKey> = {}): SpriteKey => ({
	name,
	sequence: extra.sequence ?? '',
	...extra,
});

async function mount(opts: {
	id: string;
	role?: SpriteRole;
	doc?: SpriteDoc;
	width?: number;
	height?: number;
}) {
	const saved: string[] = [];
	const t = await createTestRenderer({
		width: opts.width ?? 100,
		height: opts.height ?? 24,
		backgroundColor: RENDERER_CLEAR_COLOR,
	});
	const editor = new SpriteEditor(t.renderer, {
		id: opts.id,
		role: opts.role ?? 'hat',
		doc: opts.doc ?? emptySpriteDoc(opts.id, opts.role ?? 'hat'),
		save: (text) => saved.push(text),
	});
	editor.attach(t.renderer.root);
	await t.renderOnce();
	return { ...t, editor, saved };
}

type EditorGeometry = {
	rail: readonly RailRow[];
	layout: {
		frames: readonly { name: string; x: number; y: number }[];
	} | null;
};

function geometry(editor: SpriteEditor): EditorGeometry {
	return (editor as unknown as { geom: EditorGeometry }).geom;
}

function railPoint(
	editor: SpriteEditor,
	predicate: (action: RailAction) => boolean,
): { x: number; y: number } {
	for (const [y, row] of geometry(editor).rail.entries()) {
		let x = 0;
		for (const span of row.spans) {
			if (span.action && predicate(span.action)) return { x, y };
			x += span.text.length;
		}
	}
	throw new Error('semantic rail action is not available');
}

function canvasPoint(
	editor: SpriteEditor,
	px: number,
	py: number,
): { x: number; y: number } {
	const layout = geometry(editor).layout;
	const frame = layout?.frames.find(
		(candidate) => candidate.name === editor.state.frame,
	);
	if (!frame) throw new Error('active frame is not visible');
	return {
		x: RAIL_W + frame.x + px * editor.zoom,
		y: frame.y + py * editor.zoom,
	};
}

function parseSaved(saved: readonly string[], id: string): SpriteDoc {
	const text = saved.at(-1);
	if (!text) throw new Error('workflow did not save');
	const result = parseSpriteFile(text, id);
	if (!result.doc)
		throw new Error(
			`saved sprite did not parse: ${result.diagnostics.map((d) => d.message).join('; ')}`,
		);
	return result.doc;
}

function framePixels(doc: SpriteDoc): {
	rows: readonly string[];
	colors: readonly string[];
} {
	const frame = doc.animations[0]?.frames[0];
	if (!frame) throw new Error('saved sprite has no frame');
	return { rows: frame.rows, colors: frame.colors };
}

describe('Sprite editor headless authoring workflows', () => {
	test('keyboard and mouse strokes persist equivalent art with one undo boundary', async () => {
		const keyboard = await mount({ id: 'keyboard' });
		keyboard.editor.key(key('p'));
		keyboard.editor.key(key('space'));
		keyboard.editor.key(key('right'));
		keyboard.editor.key(key('space'));
		expect(readPixel(keyboard.editor.state, 0, 0)).toBe(true);
		expect(readPixel(keyboard.editor.state, 1, 0)).toBe(true);

		keyboard.editor.key(key('u'));
		expect(readPixel(keyboard.editor.state, 0, 0)).toBe(false);
		expect(readPixel(keyboard.editor.state, 1, 0)).toBe(false);
		keyboard.editor.key(key('u', { shift: true }));
		keyboard.editor.key(key('s', { ctrl: true }));

		const mouse = await mount({ id: 'mouse' });
		mouse.editor.key(key('p'));
		const from = canvasPoint(mouse.editor, 0, 0);
		const to = canvasPoint(mouse.editor, 1, 0);
		mouse.editor.mouseDown({ button: 0, ...from });
		mouse.editor.mouseDrag({ button: 0, ...to });
		mouse.editor.mouseUp();
		expect(readPixel(mouse.editor.state, 0, 0)).toBe(true);
		expect(readPixel(mouse.editor.state, 1, 0)).toBe(true);

		mouse.editor.key(key('u'));
		expect(readPixel(mouse.editor.state, 0, 0)).toBe(false);
		expect(readPixel(mouse.editor.state, 1, 0)).toBe(false);
		mouse.editor.key(key('u', { shift: true }));
		mouse.editor.key(key('s', { ctrl: true }));

		expect(framePixels(parseSaved(mouse.saved, 'mouse'))).toEqual(
			framePixels(parseSaved(keyboard.saved, 'keyboard')),
		);
	});

	test('the colour modal completes into saved local-colour art', async () => {
		const t = await mount({ id: 'colour' });
		const swatch = railPoint(
			t.editor,
			(action) => action.type === 'ink' && action.ink.kind === 'color',
		);
		for (let i = 0; i < 2; i++) {
			t.editor.mouseDown({ button: 0, ...swatch });
			t.editor.mouseUp();
		}

		for (const ch of '112233') t.editor.key(key(ch, { sequence: ch }));
		t.editor.key(key('enter'));
		const local = Object.entries(t.editor.state.doc.colors).find(
			([, rgba]) => rgba[0] === 0x11 && rgba[1] === 0x22 && rgba[2] === 0x33,
		);
		if (!local)
			throw new Error('colour modal did not define the requested colour');

		t.editor.key(key('p'));
		t.editor.key(key('space'));
		t.editor.key(key('space'));
		t.editor.key(key('s', { ctrl: true }));
		const saved = parseSaved(t.saved, 'colour');
		expect(saved.colors[local[0]]).toEqual([0x11, 0x22, 0x33, 255]);
		expect(saved.animations[0]?.frames[0]?.colors[0]?.[0]).toBe(local[0]);
	});

	test('the canvas modal commits one resize, supports undo, and cancels losslessly', async () => {
		const t = await mount({ id: 'canvas' });
		const before = t.editor.state.doc;
		const width = frameExtent(currentFrame(t.editor.state)).w;
		const open = () => {
			const point = railPoint(t.editor, (action) => action.type === 'canvas');
			t.editor.mouseDown({ button: 0, ...point });
			t.editor.mouseUp();
		};

		open();
		t.editor.key(key('d'));
		t.editor.key(key('enter'));
		expect(frameExtent(currentFrame(t.editor.state)).w).toBe(width + 1);
		t.editor.key(key('s', { ctrl: true }));
		expect(
			parseSaved(t.saved, 'canvas').animations[0]?.frames[0]?.rows[0]?.length,
		).toBe(width + 1);

		t.editor.key(key('u'));
		expect(t.editor.state.doc).toBe(before);
		open();
		t.editor.key(key('d'));
		t.editor.key(key('escape'));
		expect(t.editor.state.doc).toBe(before);
	});

	test('modal input is trapped and every rendered cell remains opaque', async () => {
		const t = await mount({ id: 'access' });
		t.editor.key(key('?', { sequence: '?' }));
		t.editor.key(key('space'));
		expect(readPixel(t.editor.state, 0, 0)).toBe(false);
		t.editor.key(key('escape'));
		t.editor.key(key('p'));
		t.editor.key(key('space'));
		t.editor.key(key('space'));
		expect(readPixel(t.editor.state, 0, 0)).toBe(true);

		await t.renderOnce();
		const clear = [5, 6, 10];
		for (const line of t.captureSpans().lines)
			for (const span of line.spans)
				expect(span.bg.toInts().slice(0, 3)).not.toEqual(clear);
	});
});
