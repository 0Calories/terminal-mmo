// Thin chrome smoke tests for the sprite-authoring TUI additions (issue #339):
// the pose menu, the anchor marker on the canvas, the mirror view, and
// animation playback. Logic is covered headlessly elsewhere; these assert keys
// reach the pure ops and the Renderable draws the right thing.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpriteFile, type SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';

const key = (name: string, extra: Partial<SpriteKey> = {}): SpriteKey => ({
	name,
	sequence: extra.sequence ?? '',
	...extra,
});
const seq = (s: string): SpriteKey => ({ name: s, sequence: s });

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'forge-sprite-auth-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function mount(opts: {
	doc: SpriteDoc;
	id: string;
	role: 'form' | 'weapon' | 'hat' | 'monster' | 'npc';
}) {
	const t = await createTestRenderer({ width: 100, height: 24 });
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

describe('pose menu', () => {
	test('P opens the menu and shows the poses', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		t.editor.key(seq('P'));
		await t.renderOnce();
		expect(t.editor.poseMenu).not.toBeNull();
		const frame = t.captureCharFrame();
		expect(frame).toContain('Poses');
		expect(frame).toContain('walkA');
	});

	test('creating a pose reflects in the doc and chrome', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		t.editor.key(seq('P'));
		t.editor.key(seq('c')); // create
		for (const ch of 'wave') t.editor.key(seq(ch));
		t.editor.key(key('return')); // confirm — action applied, menu stays open
		await t.renderOnce();
		expect(t.editor.state.doc.poses.wave).toBeDefined();
		// The new pose is listed in the (still-open) menu.
		expect(t.captureCharFrame()).toContain('wave');
	});
});

describe('anchor marker', () => {
	test('a form template shows its anchor markers on the canvas', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		// grip/head anchors are declared in the template → markers on the canvas.
		expect(t.captureCharFrame()).toContain('✛');
	});

	test('the anchor menu picks a name and the tool places one', async () => {
		const t = await mount({
			doc: emptySpriteDoc('cap', 'hat'),
			id: 'cap',
			role: 'hat',
		});
		expect(t.captureCharFrame()).not.toContain('✛');
		// Open the anchor menu, add a new anchor name, place it at the cursor.
		t.editor.key(seq('A'));
		t.editor.key(key('down')); // move to "+ new" (hat has no candidates)
		t.editor.key(key('return')); // open name input
		for (const ch of 'grip') t.editor.key(seq(ch));
		t.editor.key(key('return')); // select → anchor tool active
		expect(t.editor.state.tool).toBe('anchor');
		t.editor.key(key('space')); // place at cursor (0,0)
		expect(t.editor.state.doc.anchors.grip).toEqual({ x: 0, y: 0 });
		// Move the cursor off the marked cell so its marker isn't covered.
		for (let i = 0; i < 4; i++) t.editor.key(key('right'));
		await t.renderOnce();
		expect(t.captureCharFrame()).toContain('✛');
	});
});

describe('mirror view', () => {
	test('m toggles a mirror panel showing the mirrored glyph', async () => {
		// ▐ (right half block) mirrors to ▌ (left half block).
		const { doc } = parseSpriteFile('--- idle\n▐·\n··\n', 'flag');
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'flag', role: 'hat' });
		expect(t.captureCharFrame()).not.toContain('▌');
		// Move the cursor off cell (0,0) so the ▐ art isn't hidden by the cursor.
		for (let i = 0; i < 4; i++) t.editor.key(key('right'));
		t.editor.key(key('m'));
		await t.renderOnce();
		const frame = t.captureCharFrame();
		expect(frame).toContain('▐'); // right-facing art on the main canvas
		expect(frame).toContain('▌'); // mirrored art in the panel
	});
});

describe('playback', () => {
	// A two-frame pose whose frames put a block in different cells.
	function animDoc(): SpriteDoc {
		const frame = (name: string, lit: 0 | 1) => ({
			name,
			rows: [lit === 0 ? '█ ' : ' █', '  '],
			colors: [lit === 0 ? 'p ' : ' p', '  '],
			bg: ['  ', '  '],
			anchors: {},
		});
		return {
			id: 'anim',
			key: 'p',
			baseline: 0,
			anchors: {},
			poses: { idle: ['a', 'b'] },
			fps: { idle: 4 },
			colors: {},
			frames: [frame('a', 0), frame('b', 1)],
		};
	}

	test('a tick advances the displayed frame without mutating the doc', async () => {
		const t = await mount({ doc: animDoc(), id: 'anim', role: 'hat' });
		expect(t.editor.displayFrame).toBe('a');
		const docBefore = t.editor.state.doc;
		const histBefore = t.editor.state.history;

		t.editor.key(seq('.')); // start pose playback
		expect(t.editor.playing).toBe(true);
		// 260ms at 4fps → floor(0.26*4)=1 → frame 'b'.
		t.editor.tick(260);
		await t.renderOnce();
		expect(t.editor.displayFrame).toBe('b');

		// Playback is presentation only: the doc and history are untouched.
		expect(t.editor.state.doc).toBe(docBefore);
		expect(t.editor.state.history).toBe(histBefore);
	});

	test('editing is refused while playing', async () => {
		const t = await mount({ doc: animDoc(), id: 'anim', role: 'hat' });
		t.editor.key(seq('.'));
		const docBefore = t.editor.state.doc;
		t.editor.key(key('space')); // would paint — refused during playback
		expect(t.editor.state.doc).toBe(docBefore);
		expect(t.editor.state.feedback).toContain('playback');
	});

	test('a single-frame pose stays on frame 0', async () => {
		const t = await mount({
			doc: emptySpriteDoc('cap', 'hat'),
			id: 'cap',
			role: 'hat',
		});
		t.editor.key(seq('.'));
		t.editor.tick(5000);
		expect(t.editor.displayFrame).toBe('idle');
	});
});
