// Pure strips/focus layout (spec #387): geometry, hit-testing, scrolling and
// the focus tab row, asserted as observable outputs of doc + zoom — the TUI
// draws exactly this, so what these tests pin down is what the artist sees.
import { describe, expect, test } from 'bun:test';
import {
	centeredOrigin,
	clampScroll,
	FRAME_GAP,
	focusTabAt,
	focusTabs,
	frameBoxOf,
	scrollIntoView,
	stripsHit,
	stripsLayout,
} from '../src/sprite-editor/strips';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

// A form template: animations idle/walkA/walkB, one 6×4-cell frame each.
const doc = emptySpriteDoc('buddy', 'form');

describe('stripsLayout — every Animation a labeled strip of its Frames', () => {
	test('lays one labeled strip per animation, in doc order', () => {
		const l = stripsLayout(doc, 2);
		expect(l.labels.map((s) => s.animation)).toEqual([
			'idle',
			'walkA',
			'walkB',
		]);
		expect(l.labels[0].text).toContain('idle');
		expect(l.labels[0].text).toContain('1f');
	});

	test('an authored fps shows on the strip label', () => {
		const withFps = { ...doc, fps: { idle: 6 } };
		const l = stripsLayout(withFps, 2);
		expect(l.labels[0].text).toContain('6fps');
	});

	test('frame blocks are fatbits-sized: 2·cells Pixels at zoom×zoom cells each', () => {
		// 6×4 cells → 12×8 Pixels → ×2 → 24×16 screen cells, sitting under its label.
		const l = stripsLayout(doc, 2);
		const idle = frameBoxOf(l, 'idle');
		expect(idle).toMatchObject({ x: 0, y: 1, w: 24, h: 16, pxW: 12, pxH: 8 });
		// The next strip starts after the block, its name row and the gap.
		expect(l.labels[1].y).toBe(1 + 16 + 1 + 1);
	});

	test('frames of one animation sit side by side with a gap', () => {
		const two = {
			...doc,
			animations: {
				idle: ['idle', 'walkA'] as const,
				walkB: ['walkB'] as const,
			},
		};
		const l = stripsLayout(two, 1);
		const [a, b] = l.frames.filter((f) => f.animation === 'idle');
		expect(b.x).toBe(a.x + a.w + FRAME_GAP);
		expect(b.y).toBe(a.y);
	});

	test('a frame referenced by no animation still gets a strip (implicit animation)', () => {
		const orphan = {
			...doc,
			animations: { idle: ['idle'] as const },
		};
		const l = stripsLayout(orphan, 1);
		expect(l.labels.map((s) => s.animation)).toEqual([
			'idle',
			'walkA',
			'walkB',
		]);
	});

	test('content extent covers the widest strip and the last name row', () => {
		const l = stripsLayout(doc, 2);
		expect(l.contentW).toBeGreaterThanOrEqual(24);
		const last = l.frames[l.frames.length - 1];
		expect(l.contentH).toBe(last.y + last.h + 1);
	});
});

describe('stripsHit — click-through resolution', () => {
	const l = stripsLayout(doc, 2);

	test('a cell inside a block resolves to that frame and the Pixel under it', () => {
		// walkA's block; ×2 means screen (2,3) inside it is Pixel (1,1).
		const walkA = frameBoxOf(l, 'walkA');
		if (!walkA) throw new Error('walkA missing');
		const hit = stripsHit(l, walkA.x + 2, walkA.y + 3);
		expect(hit?.frame.name).toBe('walkA');
		expect(hit).toMatchObject({ px: 1, py: 1 });
	});

	test('labels, name rows and gaps are dead space', () => {
		expect(stripsHit(l, 0, 0)).toBeNull(); // the idle label row
		const idle = frameBoxOf(l, 'idle');
		if (!idle) throw new Error('idle missing');
		expect(stripsHit(l, idle.x + idle.w + 1, idle.y)).toBeNull(); // right of block
		expect(stripsHit(l, 0, idle.y + idle.h)).toBeNull(); // the name row
	});
});

describe('scrolling helpers', () => {
	test('clampScroll pins to [0, content − view]', () => {
		expect(clampScroll(-4, 100, 20)).toBe(0);
		expect(clampScroll(200, 100, 20)).toBe(80);
		expect(clampScroll(5, 10, 20)).toBe(0); // content fits — never scrolls
	});

	test('scrollIntoView makes the smallest move that shows the interval', () => {
		expect(scrollIntoView(0, 30, 34, 20)).toBe(14); // below → scroll down
		expect(scrollIntoView(50, 30, 34, 20)).toBe(30); // above → scroll up
		expect(scrollIntoView(25, 30, 34, 20)).toBe(25); // visible → unchanged
	});
});

describe('focus mode — tab row + centring', () => {
	test('tabs carry each frame name with its click extent, active marked', () => {
		const { text, tabs } = focusTabs(['idle', 'walkA', 'walkB'], 'walkA');
		expect(text).toBe(' idle │ walkA │ walkB');
		expect(tabs.find((t) => t.active)?.name).toBe('walkA');
		const hit = focusTabAt(tabs, text.indexOf('walkB') + 1);
		expect(hit?.name).toBe('walkB');
		expect(focusTabAt(tabs, text.indexOf('│'))).toBeUndefined();
	});

	test('centredOrigin centres what fits and pins what does not', () => {
		expect(centeredOrigin(24, 60)).toBe(18);
		expect(centeredOrigin(80, 60)).toBe(0);
	});
});
