import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	buildSceneStyle,
	type CellBuffer,
	drawEntitySprite,
	mapDocFrames,
	parseSpriteFile,
	type RenderStyle,
	type SpriteDoc,
} from '@mmo/render';
import {
	buildComposite,
	renderComposite,
	styleWithLocalColors,
} from '../src/sprite-editor/composite';

interface Cell {
	ch: string;
	fg: string;
	bg: string;
	blended?: boolean;
}

class FakeBuffer implements CellBuffer<string> {
	readonly width: number;
	readonly height: number;
	cells = new Map<string, Cell>();
	cleared: string | null = null;
	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
	}
	clear(bg: string): void {
		this.cleared = bg;
		this.cells.clear();
	}
	setCell(x: number, y: number, ch: string, fg: string, bg: string): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg });
	}
	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: string,
		bg: string,
	): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg, blended: true });
	}
	at(x: number, y: number): Cell | undefined {
		return this.cells.get(`${x},${y}`);
	}
}

const STYLE: RenderStyle<string> = buildSceneStyle(
	(r, g, b, a) => `${r},${g},${b},${a}`,
);

function dump(buf: FakeBuffer): string {
	const rows: string[] = [];
	for (let y = 0; y < buf.height; y++) {
		const cells: string[] = [];
		for (let x = 0; x < buf.width; x++) {
			const c = buf.at(x, y);
			cells.push(c ? `${c.ch}|${c.fg}|${c.bg}${c.blended ? '*' : ''}` : '_');
		}
		rows.push(cells.join(' '));
	}
	return rows.join('\n');
}

function loadDoc(rel: string, id: string): SpriteDoc {
	const text = readFileSync(join(import.meta.dir, '../../..', rel), 'utf8');
	const { doc } = parseSpriteFile(text, id);
	if (!doc) throw new Error(`could not parse ${rel}`);
	return doc;
}

test('a hat doc composites pixel-identically to the registry hat', () => {
	const doc = loadDoc('sprites/hats/wizard.sprite', 'wizard');
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'idle', elapsedS: 0 };

	const composite = new FakeBuffer(W, H);
	const ok = renderComposite(composite, doc, 'hat', STYLE, view);
	expect(ok).toBe(true);

	const built = buildComposite(doc, 'hat', view, { width: W, height: H });
	if (!built?.entity.cosmetics) throw new Error('expected a hat composite');
	const direct = new FakeBuffer(W, H);
	direct.clear(STYLE.bg);
	const e = {
		...built.entity,
		cosmetics: { ...built.entity.cosmetics, hat: 'wizard' },
	};
	drawEntitySprite(direct, e, { x: 0, y: 0 }, STYLE);

	expect(dump(composite)).toBe(dump(direct));
});

test('a form composite fits its whole dressed avatar in a preview-pane-sized buffer (QA round 3)', () => {
	const doc = loadDoc('sprites/forms/buddy.sprite', 'buddy');

	const buf = new FakeBuffer(32, 9);
	const ok = renderComposite(buf, doc, 'form', STYLE, {
		facing: 1,
		stance: 'idle',
		elapsedS: 0,
	});
	expect(ok).toBe(true);

	const glyphs = new Set<string>();
	for (let y = 0; y < buf.height; y++)
		for (let x = 0; x < buf.width; x++) {
			const c = buf.at(x, y);
			if (c && c.ch !== ' ') glyphs.add(c.ch);
		}
	expect(glyphs).toContain('█');
	expect(glyphs).toContain('▀');
});

test('the composed bounds center within the buffer (no edge-flush art)', () => {
	const doc = loadDoc('sprites/forms/buddy.sprite', 'buddy');
	const buf = new FakeBuffer(32, 9);
	renderComposite(buf, doc, 'form', STYLE, {
		facing: 1,
		stance: 'idle',
		elapsedS: 0,
	});
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let y = 0; y < buf.height; y++)
		for (let x = 0; x < buf.width; x++) {
			const c = buf.at(x, y);
			if (c && c.ch !== ' ') {
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
			}
		}

	const top = minY;
	const bottom = buf.height - 1 - maxY;
	expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
});

test('a weapon phase composites pixel-identically to the registry weapon', () => {
	const doc = loadDoc('sprites/weapons/sword.sprite', 'sword');
	const W = 24;
	const H = 16;

	for (const stance of ['idle', 'windup', 'active', 'recovery']) {
		const view = { facing: 1 as const, stance, elapsedS: 0 };
		const composite = new FakeBuffer(W, H);
		expect(renderComposite(composite, doc, 'weapon', STYLE, view)).toBe(true);

		const built = buildComposite(doc, 'weapon', view, { width: W, height: H });
		if (!built) throw new Error('expected a weapon composite');
		const direct = new FakeBuffer(W, H);
		direct.clear(STYLE.bg);

		drawEntitySprite(direct, built.entity, { x: 0, y: 0 }, STYLE);

		expect(dump(composite)).toBe(dump(direct));
	}
});

test('editing the WIP doc changes the composite; the registry stays put', () => {
	const doc = loadDoc('sprites/hats/wizard.sprite', 'wizard');
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'idle', elapsedS: 0 };

	const before = new FakeBuffer(W, H);
	renderComposite(before, doc, 'hat', STYLE, view);

	const blanked: SpriteDoc = mapDocFrames(doc, (f) => ({
		...f,
		rows: f.rows.map((r) => ' '.repeat(r.length)),
	}));
	const after = new FakeBuffer(W, H);
	renderComposite(after, blanked, 'hat', STYLE, view);

	expect(dump(after)).not.toBe(dump(before));

	const built = buildComposite(doc, 'hat', view, { width: W, height: H });
	if (!built?.entity.cosmetics) throw new Error('expected a hat composite');
	const registry = new FakeBuffer(W, H);
	registry.clear(STYLE.bg);
	drawEntitySprite(
		registry,
		{
			...built.entity,
			cosmetics: { ...built.entity.cosmetics, hat: 'wizard' },
		},
		{ x: 0, y: 0 },
		STYLE,
	);
	expect(dump(registry)).toBe(dump(before));
});

function localColorDoc(): SpriteDoc {
	return {
		id: 'blob',
		key: 'w',
		baseline: 0,
		anchors: {},
		animations: [
			{
				name: 'idle',
				frames: [
					{
						rows: ['██', '██'],
						colors: ['zz', 'zz'],
						bg: ['  ', '  '],
						anchors: {},
					},
				],
			},
		],
		colors: { z: [11, 22, 33, 255] },
	};
}

function firstGlyph(buf: FakeBuffer, ch: string): Cell | undefined {
	for (const cell of buf.cells.values()) if (cell.ch === ch) return cell;
	return undefined;
}

test('styleWithLocalColors merges custom keys; local wins; empty is a no-op', () => {
	expect(
		styleWithLocalColors(STYLE, {}, (r, g, b, a) => `${r},${g},${b},${a}`),
	).toBe(STYLE);
	const merged = styleWithLocalColors(
		STYLE,
		{ z: [11, 22, 33, 255], w: [1, 2, 3, 255] },
		(r, g, b, a) => `${r},${g},${b},${a}`,
	);

	expect(merged.palette.z).toBe('11,22,33,255');

	expect(merged.palette.w).toBe('1,2,3,255');
	expect(merged.palette.w).not.toBe(STYLE.palette.w);

	expect(STYLE.palette.z).toBeUndefined();
});

test('file-local colours render in the composite once merged into the style (#393)', () => {
	const doc = localColorDoc();
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'idle', elapsedS: 0 };

	const fallback = new FakeBuffer(W, H);
	expect(renderComposite(fallback, doc, 'monster', STYLE, view)).toBe(true);

	const merged = styleWithLocalColors(
		STYLE,
		doc.colors,
		(r, g, b, a) => `${r},${g},${b},${a}`,
	);
	const faithful = new FakeBuffer(W, H);
	expect(renderComposite(faithful, doc, 'monster', merged, view)).toBe(true);

	expect(dump(fallback).replace(/\|[^ ]*/g, '')).toBe(
		dump(faithful).replace(/\|[^ ]*/g, ''),
	);
	const before = firstGlyph(fallback, '█');
	const after = firstGlyph(faithful, '█');
	expect(before?.fg).toBe(STYLE.paletteDefault);
	expect(after?.fg).toBe('11,22,33,255');
	expect(after?.fg).not.toBe(before?.fg);
});

test('facing flips the composite (mirroring goes through the renderer)', () => {
	const doc = loadDoc('sprites/forms/buddy.sprite', 'buddy');
	const W = 24;
	const H = 16;
	const right = new FakeBuffer(W, H);
	renderComposite(right, doc, 'form', STYLE, {
		facing: 1,
		stance: 'idle',
		elapsedS: 0,
	});
	const left = new FakeBuffer(W, H);
	renderComposite(left, doc, 'form', STYLE, {
		facing: -1,
		stance: 'idle',
		elapsedS: 0,
	});
	expect(dump(left)).not.toBe(dump(right));
});

function overrideFormDoc(
	sitAnchors: Record<string, { x: number; y: number }>,
): SpriteDoc {
	const art = {
		rows: ['███', '███'],
		colors: ['ppp', 'ppp'],
		bg: ['   ', '   '],
	};
	return {
		id: 'stick',
		key: 'p',
		baseline: 0,
		anchors: { grip: { x: 2, y: 1 }, head: { x: 1, y: 0 } },
		animations: [
			{ name: 'idle', frames: [{ ...art, anchors: {} }] },
			{ name: 'emote:sit', frames: [{ ...art, anchors: sitAnchors }] },
		],
		colors: {},
	};
}

test('a frame-level head override moves the hat in the form composite, exactly like grip (#351 QA round 5)', () => {
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'emote:sit', elapsedS: 0 };
	const render = (doc: SpriteDoc) => {
		const buf = new FakeBuffer(W, H);
		renderComposite(buf, doc, 'form', STYLE, view);
		return dump(buf);
	};

	const base = render(overrideFormDoc({}));

	const headMoved = render(overrideFormDoc({ head: { x: 0, y: 2 } }));
	expect(headMoved).not.toBe(base);
	const gripMoved = render(overrideFormDoc({ grip: { x: 0, y: 2 } }));
	expect(gripMoved).not.toBe(base);

	const doc = overrideFormDoc({});
	const docLevel: SpriteDoc = {
		...doc,
		anchors: { ...doc.anchors, head: { x: 0, y: 2 } },
	};
	expect(headMoved).toBe(render(docLevel));
});

test('the view hue drives the composite body hue; omitted → canonical 0', () => {
	const doc = loadDoc('sprites/hats/cap.sprite', 'cap');
	const dims = { width: 24, height: 16 };
	const picked = buildComposite(
		doc,
		'hat',
		{ facing: 1, stance: 'idle', elapsedS: 0, hue: 3 },
		dims,
	);
	expect(picked?.entity.cosmetics?.hue).toBe(3);
	const canonical = buildComposite(
		doc,
		'hat',
		{ facing: 1, stance: 'idle', elapsedS: 0 },
		dims,
	);
	expect(canonical?.entity.cosmetics?.hue).toBe(0);
});
