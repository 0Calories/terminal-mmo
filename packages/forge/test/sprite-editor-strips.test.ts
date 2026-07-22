import { describe, expect, test } from 'bun:test';
import {
	centeredOrigin,
	clampScroll,
	FRAME_GAP,
	focusTabAt,
	focusTabs,
	frameBoxOf,
	scrollIntoView,
	stepperHit,
	stripsHit,
	stripsLayout,
} from '../src/sprite-editor/strips';
import { emptySpriteDoc } from '../src/sprite-editor/templates';

const doc = emptySpriteDoc('buddy', 'form');

describe('stripsLayout — every Animation a labeled strip of its Frames', () => {
	test('lays one labeled strip per animation, in doc order', () => {
		const l = stripsLayout(doc, 2);
		expect(l.labels.map((s) => s.animation)).toEqual(['idle', 'walk']);

		expect(l.labels[0].text).toBe('idle');
	});

	test('the strip label carries only the animation name — no frame count or fps', () => {
		const withFps = {
			...doc,
			animations: doc.animations.map((a) => ({ ...a, fps: 6 })),
		};
		const l = stripsLayout(withFps, 2);
		for (const label of l.labels) expect(label.text).toBe(label.animation);
	});

	test('frame blocks are fatbits-sized: 2·cells Pixels at zoom×zoom cells each', () => {
		const l = stripsLayout(doc, 2);
		const idle = frameBoxOf(l, 'idle');
		expect(idle).toMatchObject({ x: 0, y: 1, w: 24, h: 16, pxW: 12, pxH: 8 });

		expect(l.labels[1].y).toBe(1 + 16 + 1 + 1);
	});

	test('frames of one animation sit side by side with a gap', () => {
		const l = stripsLayout(doc, 1);
		const [a, b] = l.frames.filter((f) => f.animation === 'walk');
		expect(b.x).toBe(a.x + a.w + FRAME_GAP);
		expect(b.y).toBe(a.y);
	});

	test('every declared animation gets its own labeled strip, in doc order', () => {
		const extended = {
			...doc,
			animations: [
				...doc.animations,
				{ name: 'jump', frames: [doc.animations[0].frames[0]] },
			],
		};
		const l = stripsLayout(extended, 1);
		expect(l.labels.map((s) => s.animation)).toEqual(['idle', 'walk', 'jump']);
	});

	test('content extent covers the widest strip and the last name row', () => {
		const l = stripsLayout(doc, 2);
		expect(l.contentW).toBeGreaterThanOrEqual(24);
		const last = l.frames[l.frames.length - 1];
		expect(l.contentH).toBe(last.y + last.h + 1);
	});
});

describe('fps stepper — multi-frame strips only (QA round 3)', () => {
	test('a multi-frame strip carries a ‹ Nfps › stepper on its label row, right-justified to the strip edge; single-frame strips none', () => {
		const l = stripsLayout(doc, 2);
		expect(l.steppers).toHaveLength(1);
		const st = l.steppers[0];
		expect(st.animation).toBe('walk');
		expect(st.text).toBe('‹ 5fps ›');

		const walkIdx = l.labels.findIndex((lb) => lb.animation === 'walk');
		expect(st.y).toBe(l.labels[walkIdx].y);

		const walkFrames = l.frames.filter((f) => f.animation === 'walk');
		const stripRight = Math.max(...walkFrames.map((f) => f.x + f.w));
		expect(st.x + st.text.length).toBe(stripRight);

		expect(st.x).toBeGreaterThanOrEqual(l.labels[walkIdx].text.length + 1);
	});

	test('a strip too narrow for name + stepper clamps the stepper clear of the name (may overhang the edge)', () => {
		const tiny = doc.animations[0].frames[0];
		const narrow = {
			...doc,
			animations: [
				{ name: 'a-very-long-animation-name', frames: [tiny, tiny] },
			],
		};
		const l = stripsLayout(narrow, 1);
		const st = l.steppers[0];
		const name = l.labels[0].text.length;
		expect(st.x).toBe(name + 1);
		const frames = l.frames;
		const stripRight = Math.max(...frames.map((f) => f.x + f.w));

		expect(st.x + st.text.length).toBeGreaterThan(stripRight);

		expect(l.contentW).toBeGreaterThanOrEqual(st.x + st.text.length);
	});

	test('an authored fps shows in the stepper text', () => {
		const withFps = {
			...doc,
			animations: doc.animations.map((a) =>
				a.name === 'walk' ? { ...a, fps: 12 } : a,
			),
		};
		const l = stripsLayout(withFps, 2);
		expect(l.steppers[0].text).toBe('‹ 12fps ›');
	});

	test('stepperHit resolves the chevrons to ±1 and the number to dead space', () => {
		const l = stripsLayout(doc, 2);
		const st = l.steppers[0];
		expect(stepperHit(l, st.x, st.y)).toEqual({
			animation: 'walk',
			delta: -1,
		});
		expect(stepperHit(l, st.x + st.text.length - 1, st.y)).toEqual({
			animation: 'walk',
			delta: 1,
		});
		expect(stepperHit(l, st.x + 3, st.y)).toBeNull();
		expect(stepperHit(l, st.x, st.y + 1)).toBeNull();
	});
});

describe('stripsHit — click-through resolution', () => {
	const l = stripsLayout(doc, 2);

	test('a cell inside a block resolves to that frame and the Pixel under it', () => {
		const walkA = frameBoxOf(l, 'walk 0');
		if (!walkA) throw new Error('walk 0 missing');
		const hit = stripsHit(l, walkA.x + 2, walkA.y + 3);
		expect(hit?.frame.name).toBe('walk 0');
		expect(hit).toMatchObject({ px: 1, py: 1 });
	});

	test('labels, name rows and gaps are dead space', () => {
		expect(stripsHit(l, 0, 0)).toBeNull();
		const idle = frameBoxOf(l, 'idle');
		if (!idle) throw new Error('idle missing');
		expect(stripsHit(l, idle.x + idle.w + 1, idle.y)).toBeNull();
		expect(stripsHit(l, 0, idle.y + idle.h)).toBeNull();
	});
});

describe('scrolling helpers', () => {
	test('clampScroll pins to [0, content − view]', () => {
		expect(clampScroll(-4, 100, 20)).toBe(0);
		expect(clampScroll(200, 100, 20)).toBe(80);
		expect(clampScroll(5, 10, 20)).toBe(0);
	});

	test('scrollIntoView makes the smallest move that shows the interval', () => {
		expect(scrollIntoView(0, 30, 34, 20)).toBe(14);
		expect(scrollIntoView(50, 30, 34, 20)).toBe(30);
		expect(scrollIntoView(25, 30, 34, 20)).toBe(25);
	});
});

describe('focus mode — tab row + centring', () => {
	test('tabs carry each frame name with its click extent, active marked', () => {
		const { text, tabs } = focusTabs(['idle', 'walk', 'jump'], 'walk');
		expect(text).toBe(' frame 0 │ frame 1 │ frame 2');
		expect(tabs.find((t) => t.active)?.name).toBe('walk');
		const hit = focusTabAt(tabs, text.indexOf('frame 2') + 1);
		expect(hit?.name).toBe('jump');
		expect(focusTabAt(tabs, text.indexOf('│'))).toBeUndefined();
	});

	test('centredOrigin centres what fits and pins what does not', () => {
		expect(centeredOrigin(24, 60)).toBe(18);
		expect(centeredOrigin(80, 60)).toBe(0);
	});
});
