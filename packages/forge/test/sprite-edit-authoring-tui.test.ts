// Thin chrome smoke tests for the sprite-authoring TUI additions (issue #339):
// the animation menu, the anchor marker on the canvas, the mirror view, and
// animation playback. Logic is covered headlessly elsewhere; these assert keys
// reach the pure ops and the Renderable draws the right thing.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENE_PALETTE } from '@mmo/core/entities';
import {
	allFrames,
	findFrame,
	parseSpriteFile,
	type SpriteDoc,
} from '@mmo/render';
import { createTestRenderer } from '@opentui/core/testing';
import { selectFrame } from '../src/sprite-editor/state';
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

// Click the Composited preview pane's ▶ play / ■ stop control (post-#351: play
// moved off the rail to the pane's bottom border). Requires the pane visible.
async function clickPanePlay(
	t: Awaited<ReturnType<typeof mount>>,
): Promise<void> {
	await t.renderOnce();
	// biome-ignore lint/suspicious/noExplicitAny: reach the private pane geometry.
	const pane = (t.editor as any).geom.preview;
	if (!pane) throw new Error('preview pane not shown — cannot click ▶ play');
	t.editor.mouseDown({ button: 0, x: pane.play.x0, y: pane.play.y });
	t.editor.mouseUp();
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
		expect(
			t.editor.state.doc.animations.find((a) => a.name === 'wave'),
		).toBeDefined();
		// The new animation is listed in the (still-open) menu.
		expect(t.captureCharFrame()).toContain('wave');
	});
});

describe('mouse-native anchors (ADR 0036)', () => {
	// The form template: grip (4,2), head (2,0); active block at (RAIL_W=30, 1),
	// zoom ×2 → cell (cx,cy) renders its marker at (30 + cx*4, 1 + cy*4).
	const markerAt = (cx: number, cy: number) => ({
		x: 30 + cx * 4,
		y: 1 + cy * 4,
	});

	test('dragging a ✛ marker on the Default frame moves the file-level anchor in one undo step', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		expect(t.editor.state.doc.anchors.grip).toEqual({ x: 4, y: 2 });
		const from = markerAt(4, 2);
		const to = markerAt(1, 1);
		t.editor.mouseDown({ button: 0, x: from.x, y: from.y });
		t.editor.mouseDrag({ button: 0, x: to.x, y: to.y });
		t.editor.mouseUp();
		expect(t.editor.state.doc.anchors.grip).toEqual({ x: 1, y: 1 });
		// File-level: no override was authored on the Default frame.
		expect(
			allFrames(t.editor.state.doc).every((f) => f.anchors.grip === undefined),
		).toBe(true);
		// One undo step restores it.
		t.editor.key(key('u'));
		expect(t.editor.state.doc.anchors.grip).toEqual({ x: 4, y: 2 });
	});

	test("the same drag on a non-Default frame authors that frame's override; right-click clears it", async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		t.editor.state = selectFrame(t.editor.state, 'walk 0');
		t.editor.key(key('p')); // pencil: enter dives only for a non-gesture tool (default is select)
		t.editor.key(key('return')); // focus the frame so its markers are on screen
		await t.renderOnce();
		// grip (4,2) is the bottom-most ✛ on screen; head (2,0) the top-most.
		const marks = () => {
			const rows = t.captureCharFrame().split('\n');
			const out: { x: number; y: number }[] = [];
			rows.forEach((r, y) => {
				for (let x = r.indexOf('✛'); x >= 0; x = r.indexOf('✛', x + 1))
					out.push({ x, y });
			});
			return out.sort((a, b) => a.y - b.y);
		};
		const grip = marks().at(-1);
		if (!grip) throw new Error('no grip marker on screen');
		// One cell left = 4 screen columns at zoom ×2.
		const to = { x: grip.x - 4, y: grip.y };
		t.editor.mouseDown({ button: 0, x: grip.x, y: grip.y });
		t.editor.mouseDrag({ button: 0, x: to.x, y: to.y });
		t.editor.mouseUp();
		const walk0 = () => findFrame(t.editor.state.doc, 'walk 0')?.frame;
		expect(walk0()?.anchors.grip).toEqual({ x: 3, y: 2 });
		expect(t.editor.state.doc.anchors.grip).toEqual({ x: 4, y: 2 }); // doc untouched
		// Right-click the (amber, overridden) marker at its new cell clears it.
		await t.renderOnce();
		t.editor.mouseDown({ button: 2, x: to.x, y: to.y });
		t.editor.mouseUp();
		expect(walk0()?.anchors.grip).toBeUndefined();
	});

	test('the anchor menu is mouse-native: click a row arms it, the next canvas click places (no spacebar)', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		await clickRail(t, /\banchor\b/);
		expect(t.editor.anchorMenu).not.toBeNull();
		await t.renderOnce();
		// Click the 'head' row (row 1 under the title) inside the modal box.
		const rows = t.captureCharFrame().split('\n');
		let headRow = -1;
		let headX = -1;
		for (let y = 0; y < rows.length; y++) {
			const x = rows[y].indexOf(' head');
			if (x >= 0) {
				headRow = y;
				headX = x + 1;
				break;
			}
		}
		if (headRow < 0) throw new Error('no head row in the anchor menu');
		t.editor.mouseDown({ button: 0, x: headX, y: headRow });
		t.editor.mouseUp();
		expect(t.editor.anchorMenu).toBeNull();
		expect(t.editor.state.tool).toBe('anchor');
		expect(t.editor.state.anchorName).toBe('head');
		// The next canvas click places it — cell (1,0) is block cell → screen.
		await t.renderOnce();
		t.editor.mouseDown({ button: 0, x: 30 + 1 * 4, y: 1 + 0 * 4 });
		t.editor.mouseUp();
		expect(t.editor.state.doc.anchors.head).toEqual({ x: 1, y: 0 });
	});

	test('the menu deletes a non-required anchor via its ✕; required rows carry no ✕', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		// Author a custom doc-level anchor 'tail' via the menu's + new input.
		await clickRail(t, /\banchor\b/);
		t.editor.key(key('down'));
		t.editor.key(key('down')); // + new
		t.editor.key(key('return'));
		for (const ch of 'tail') t.editor.key(seq(ch));
		t.editor.key(key('return')); // armed
		await t.renderOnce();
		t.editor.mouseDown({ button: 0, x: 30, y: 1 }); // place at cell (0,0)
		t.editor.mouseUp();
		expect(t.editor.state.doc.anchors.tail).toEqual({ x: 0, y: 0 });
		// Reopen: tail shows a ✕, grip (required) does not.
		await clickRail(t, /\banchor\b/);
		await t.renderOnce();
		const frame = t.captureCharFrame();
		const rows = frame.split('\n');
		const tailRow = rows.find((r) => r.includes(' tail'));
		const gripRow = rows.find((r) => r.includes(' grip'));
		expect(tailRow).toContain('✕');
		expect(gripRow).not.toContain('✕');
		// Click tail's ✕ (the right edge of the modal row) deletes it.
		const y = rows.findIndex((r) => r.includes(' tail'));
		const x = rows[y].indexOf('✕', rows[y].indexOf(' tail'));
		t.editor.mouseDown({ button: 0, x, y });
		t.editor.mouseUp();
		expect(t.editor.state.doc.anchors.tail).toBeUndefined();
	});

	test('the Default frame is badged ◈ in the strips name row', async () => {
		const t = await mount({
			doc: emptySpriteDoc('buddy', 'form'),
			id: 'buddy',
			role: 'form',
		});
		expect(t.captureCharFrame()).toContain('◈frame 0');
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
			'{ "anchors": { "grip": [0, 0] }, "animations": [{ "name": "idle" }] }\n--- idle\n██\n██\n',
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

describe('mirror view (deleted, round 3)', () => {
	test('the canvas-split mirror feature is gone — no rail mirror button, no split', async () => {
		// ▐ (right half block) would have mirrored to ▌ (left half block) in the old
		// mirror panel; with the feature deleted the panel never renders and there is
		// no rail button to toggle it.
		const { doc } = parseSpriteFile(
			'{ "animations": [{ "name": "idle" }] }\n--- idle\n▐·\n··\n',
			'flag',
		);
		if (!doc) throw new Error('fixture failed to parse');
		const t = await mount({ doc, id: 'flag', role: 'hat' });
		await t.renderOnce();
		// The rail carries no mirror button.
		const railRows = t
			.captureCharFrame()
			.split('\n')
			.map((r) => r.slice(0, 30));
		expect(railRows.some((r) => /\bmirror\b/.test(r))).toBe(false);
		// Drop the floating preview (whose avatar art may contain ▌) and confirm the
		// canvas never paints the old mirror panel's mirrored ▌ glyph.
		await clickRail(t, /\bpreview\b/);
		await t.renderOnce();
		expect(t.captureCharFrame()).not.toContain('▌');
	});
});

describe('focus [+] tile clones the last frame (round 3)', () => {
	function twoFrameDoc(): SpriteDoc {
		const frame = () => ({
			rows: ['█ ', '  '],
			colors: ['p ', '  '],
			bg: ['  ', '  '],
			anchors: {},
		});
		return {
			id: 'clone',
			key: 'p',
			baseline: 0,
			anchors: {},
			animations: [{ name: 'idle', frames: [frame(), frame()] }],
			colors: {},
		};
	}

	test('clicking the [+] tile appends a clone of the last frame and selects it', async () => {
		const t = await mount({ doc: twoFrameDoc(), id: 'clone', role: 'hat' });
		// Drop the floating pane so the tile is never occluded by it.
		await clickRail(t, /\bpreview\b/);
		t.editor.key(key('tab')); // strips → focus
		t.editor.key(key('right')); // step to the last frame so the tile is on-screen
		await t.renderOnce();
		const before = t.editor.state.doc.animations[0].frames.length;
		// biome-ignore lint/suspicious/noExplicitAny: reach the private focus geometry.
		const tile = (t.editor as any).geom.focus.plusTile as {
			x0: number;
			y0: number;
			y1: number;
		} | null;
		if (!tile) throw new Error('no [+] tile on-screen');
		const midY = Math.floor((tile.y0 + tile.y1) / 2);
		t.editor.mouseDown({ button: 0, x: tile.x0, y: midY });
		t.editor.mouseUp();
		expect(t.editor.state.doc.animations[0].frames.length).toBe(before + 1);
		// The new (cloned) frame is active.
		expect(t.editor.state.frame).toBe('idle 2');
	});
});

describe('playback', () => {
	// A two-frame animation whose frames put a block in different cells. In v2
	// (ADR 0037) frames are unnamed — the 'idle' animation's two frames carry the
	// positional labels 'idle 0' and 'idle 1'.
	function animDoc(): SpriteDoc {
		const frame = (lit: 0 | 1) => ({
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
			animations: [{ name: 'idle', fps: 4, frames: [frame(0), frame(1)] }],
			colors: {},
		};
	}

	test('playback is not a trap: rail stop, pane stop and esc all end it; painting stays gated (ADR 0036)', async () => {
		// Rail play button toggles off again.
		const t1 = await mount({ doc: animDoc(), id: 'anim', role: 'hat' });
		await clickPanePlay(t1);
		expect(t1.editor.playing).toBe(true);
		await clickPanePlay(t1);
		expect(t1.editor.playing).toBe(false);

		// esc stops playback.
		const t2 = await mount({ doc: animDoc(), id: 'anim2', role: 'hat' });
		await clickPanePlay(t2);
		expect(t2.editor.playing).toBe(true);
		t2.editor.key(key('escape'));
		expect(t2.editor.playing).toBe(false);

		// The preview pane's ■ stop control stops it.
		const t3 = await mount({ doc: animDoc(), id: 'anim3', role: 'hat' });
		await clickPanePlay(t3);
		expect(t3.editor.playing).toBe(true);
		await t3.renderOnce();
		const rows = t3.captureCharFrame().split('\n');
		let stop: { x: number; y: number } | null = null;
		for (let y = 0; y < rows.length; y++) {
			const x = rows[y].indexOf('■ stop');
			if (x >= 0) {
				stop = { x, y };
				break;
			}
		}
		if (!stop) throw new Error('no ■ stop control on screen');
		t3.editor.mouseDown({ button: 0, x: stop.x, y: stop.y });
		t3.editor.mouseUp();
		expect(t3.editor.playing).toBe(false);

		// While playing, a canvas click paints nothing (playback gates paint only).
		const t4 = await mount({ doc: animDoc(), id: 'anim4', role: 'hat' });
		await clickPanePlay(t4);
		const docBefore = t4.editor.state.doc;
		t4.editor.mouseDown({ button: 0, x: 45, y: 5 });
		t4.editor.mouseUp();
		expect(t4.editor.state.doc).toBe(docBefore);
		expect(t4.editor.state.history.past.length).toBe(0);
		expect(t4.editor.playing).toBe(true);
	});

	test('the preview pane carries ▶ play but not ▶ walk (round 3: walk lives only in the menu)', async () => {
		const t = await mount({ doc: animDoc(), id: 'panewalk', role: 'hat' });
		await t.renderOnce();
		const rows = t.captureCharFrame().split('\n');
		// Play lives on the pane's bottom border; walk was removed from the pane.
		expect(rows.some((r) => r.includes('▶ play'))).toBe(true);
		expect(rows.some((r) => r.includes('▶ walk'))).toBe(false);
	});

	test('the animation menu w entry starts walk playback (the pane auto-hides small)', async () => {
		const t = await mount({ doc: animDoc(), id: 'menuwalk', role: 'hat' });
		await clickRail(t, /\banimation\b/); // open the animation menu (mouse-native)
		t.editor.key(key('w', { sequence: 'w' }));
		expect(t.editor.playing).toBe(true);
		// biome-ignore lint/suspicious/noExplicitAny: read the private play mode.
		expect((t.editor as any).playMode).toBe('walk');
	});

	test('a tick advances the displayed frame without mutating the doc', async () => {
		const t = await mount({ doc: animDoc(), id: 'anim', role: 'hat' });
		expect(t.editor.displayFrame).toBe('idle 0');
		const docBefore = t.editor.state.doc;
		const histBefore = t.editor.state.history;

		await clickPanePlay(t); // start animation playback
		expect(t.editor.playing).toBe(true);
		// 260ms at 4fps → floor(0.26*4)=1 → frame 'idle 1'.
		t.editor.tick(260);
		await t.renderOnce();
		expect(t.editor.displayFrame).toBe('idle 1');

		// Playback is presentation only: the doc and history are untouched.
		expect(t.editor.state.doc).toBe(docBefore);
		expect(t.editor.state.history).toBe(histBefore);
	});

	test('editing is refused while playing', async () => {
		const t = await mount({ doc: animDoc(), id: 'anim', role: 'hat' });
		await clickPanePlay(t);
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
		await clickPanePlay(t);
		t.editor.tick(5000);
		expect(t.editor.displayFrame).toBe('idle');
	});
});
