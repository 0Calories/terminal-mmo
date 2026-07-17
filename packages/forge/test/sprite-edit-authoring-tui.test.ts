// Thin chrome smoke tests for the sprite-authoring TUI additions (issue #339):
// the animation menu, the anchor marker on the canvas, the mirror view, and
// animation playback. Logic is covered headlessly elsewhere; these assert keys
// reach the pure ops and the Renderable draws the right thing.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENE_PALETTE } from '@mmo/core/entities';
import { parseSpriteFile, type SpriteDoc } from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { emptySpriteDoc } from '../src/sprite-editor/templates';
import { SpriteEditor, type SpriteKey } from '../src/sprite-editor/tui';
import { resolveColorKey, SPRITE_PREVIEWS } from '../src/sprite-editor/view';

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

// Click the rail button whose label matches `re` in the rendered frame's rail
// region (mouse-primary, QA round 3: the P/A/v/m/. keys died).
async function clickRail(
	t: Awaited<ReturnType<typeof mount>>,
	re: RegExp,
): Promise<void> {
	await t.renderOnce();
	const rows = t.captureCharFrame().split('\n');
	for (let y = 0; y < rows.length; y++) {
		const rail = rows[y].slice(0, 30);
		const m = re.exec(rail);
		if (m) {
			t.editor.mouseDown({ button: 0, x: m.index + 1, y });
			t.editor.mouseUp();
			return;
		}
	}
	throw new Error(`no rail button matching ${re}`);
}

describe('animation menu', () => {
	test('P opens the menu and shows the animations', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		await clickRail(t, /\banimation\b/);
		await t.renderOnce();
		expect(t.editor.animationMenu).not.toBeNull();
		const frame = t.captureCharFrame();
		expect(frame).toContain('Animations');
		expect(frame).toContain('walk');
	});

	test('creating an animation reflects in the doc and chrome', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		await clickRail(t, /\banimation\b/);
		t.editor.key(seq('c')); // create
		for (const ch of 'wave') t.editor.key(seq(ch));
		t.editor.key(key('return')); // confirm — action applied, menu stays open
		await t.renderOnce();
		expect(t.editor.state.doc.animations.wave).toBeDefined();
		// The new animation is listed in the (still-open) menu.
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

	test('the marker overlays the art: its cell keeps the art colour, no opaque bg stamp (QA round 3)', async () => {
		// A hat whose art fully lights the anchor cell — the marker at (0,0) sits
		// over painted 'p' pixels, so its background must be the art's colour.
		const { doc } = parseSpriteFile(
			'{ "anchors": { "grip": [0, 0] } }\n--- idle\n██\n██\n',
			'lit',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'lit', role: 'hat' });
		// Move the cursor off the marker cell so its ring doesn't cover it.
		for (let i = 0; i < 4; i++) t.editor.key(key('right'));
		await t.renderOnce();
		// The active frame's block starts at (RAIL_W=30, 1) in the strips view;
		// anchor (0,0)'s marker sits at its origin cell.
		const cap = t.captureSpans();
		const cell = (x: number, y: number) => {
			let col = 0;
			for (const s of cap.lines[y].spans) {
				if (x < col + s.width)
					return { ch: s.text[x - col] ?? ' ', bg: s.bg.toInts() };
				col += s.width;
			}
			return null;
		};
		const marker = cell(30, 1);
		expect(marker?.ch).toBe('✛');
		const p = resolveColorKey('p', doc.colors, SCENE_PALETTE, SPRITE_PREVIEWS);
		if (!p) throw new Error('p did not resolve');
		expect(marker?.bg.slice(0, 3)).toEqual([p[0], p[1], p[2]]);
	});

	test('the anchor menu picks a name and the tool places one', async () => {
		const t = await mount({
			doc: emptySpriteDoc('cap', 'hat'),
			id: 'cap',
			role: 'hat',
		});
		expect(t.captureCharFrame()).not.toContain('✛');
		// Open the anchor menu, add a new anchor name, place it at the cursor.
		await clickRail(t, /\banchor\b/);
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
		// ▐ (right half block) mirrors to ▌ (left half block). The fatbits main
		// canvas paints the art as colour blocks; the mirror panel still renders
		// glyphs, so its mirrored art shows as the ▌ glyph.
		const { doc } = parseSpriteFile('--- idle\n▐·\n··\n', 'flag');
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'flag', role: 'hat' });
		// Isolate the mirror panel: the always-on floating preview (#393) otherwise
		// docks over the top-right, covering the mirror panel it shares that side
		// with. `v` drops the preview so this test exercises mirror alone.
		await clickRail(t, /\bpreview\b/);
		await t.renderOnce();
		expect(t.captureCharFrame()).not.toContain('▌');
		await clickRail(t, /\bmirror\b/);
		await t.renderOnce();
		// The mirrored ▌ glyph appears in the panel.
		expect(t.captureCharFrame()).toContain('▌');
		// The right-facing art is a colour block on the main (left) canvas region.
		const fg = resolveColorKey(
			doc.key,
			doc.colors,
			SCENE_PALETTE,
			SPRITE_PREVIEWS,
		);
		if (!fg) throw new Error('fixture fg did not resolve');
		const cap = t.captureSpans();
		const dividerCol = Math.floor((100 - 1) / 2);
		let found = false;
		for (let y = 0; y < 20 && !found; y++) {
			let col = 0;
			for (const s of cap.lines[y].spans) {
				const [r, g, b] = s.bg.toInts();
				if (col < dividerCol && r === fg[0] && g === fg[1] && b === fg[2])
					found = true;
				col += s.width;
			}
		}
		expect(found).toBe(true);
	});
});

describe('playback', () => {
	// A two-frame animation whose frames put a block in different cells.
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
			animations: { idle: ['a', 'b'] },
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

		await clickRail(t, /\bplay\b/); // start animation playback
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
		await clickRail(t, /\bplay\b/);
		const docBefore = t.editor.state.doc;
		t.editor.key(key('space')); // would paint — refused during playback
		expect(t.editor.state.doc).toBe(docBefore);
		expect(t.editor.state.feedback).toContain('playback');
	});

	test('a single-frame animation stays on frame 0', async () => {
		const t = await mount({
			doc: emptySpriteDoc('cap', 'hat'),
			id: 'cap',
			role: 'hat',
		});
		await clickRail(t, /\bplay\b/);
		t.editor.tick(5000);
		expect(t.editor.displayFrame).toBe('idle');
	});
});
