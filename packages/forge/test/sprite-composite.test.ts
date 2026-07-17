// The Composited preview's fidelity contract (ADR 0031, #340): forge composes the
// WIP doc THROUGH the shared renderer via the `SpriteOverrides` seam, so the
// output is pixel-identical to the game. These tests pin that:
//   (a) a hat doc composites at the body's head anchor exactly where a direct
//       `drawEntitySprite` call (registry hat) seats it — pixel-identical;
//   (b) a weapon phase composites identically to the golden scene path (direct
//       call, registry weapon, same action);
//   (c) the WIP doc's edits (not the saved file the registry holds) drive output.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	buildSceneStyle,
	type CellBuffer,
	drawEntitySprite,
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

// --- (a) hat seats exactly where drawEntitySprite would ---------------------

test('a hat doc composites pixel-identically to the registry hat', () => {
	const doc = loadDoc('sprites/hats/wizard.sprite', 'wizard');
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'idle', elapsedS: 0 };

	// Composite path: WIP hat injected via the overrides seam.
	const composite = new FakeBuffer(W, H);
	const ok = renderComposite(composite, doc, 'hat', STYLE, view);
	expect(ok).toBe(true);

	// Direct path: the SAME entity, hat resolved from the registry (id 'wizard').
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

// --- (b) weapon phases match the golden scene path --------------------------

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
		// weapon 0 (sword) is what the entity already carries; drop the override so
		// the piece resolves from the registry — identical compiled art.
		drawEntitySprite(direct, built.entity, { x: 0, y: 0 }, STYLE);

		expect(dump(composite)).toBe(dump(direct));
	}
});

// --- (c) the WIP doc (not the saved file) drives output ---------------------

test('editing the WIP doc changes the composite; the registry stays put', () => {
	const doc = loadDoc('sprites/hats/wizard.sprite', 'wizard');
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'idle', elapsedS: 0 };

	const before = new FakeBuffer(W, H);
	renderComposite(before, doc, 'hat', STYLE, view);

	// Blank out the hat's art in the WIP doc — a change the saved file never saw.
	const blanked: SpriteDoc = {
		...doc,
		frames: doc.frames.map((f) => ({
			...f,
			rows: f.rows.map((r) => ' '.repeat(r.length)),
		})),
	};
	const after = new FakeBuffer(W, H);
	renderComposite(after, blanked, 'hat', STYLE, view);

	// The WIP edit must show through — a blanked hat renders differently.
	expect(dump(after)).not.toBe(dump(before));

	// And the registry-backed render of id 'wizard' still shows the SAVED art,
	// proving the composite reads the live doc, not the frozen registry.
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

// --- (d) file-local colours render faithfully once merged (#393) ------------

// A minimal monster doc whose 2×2 art paints an opaque block in a file-local
// custom colour key 'z' — a key absent from the scene palette on purpose.
function localColorDoc(): SpriteDoc {
	return {
		id: 'blob',
		key: 'w',
		baseline: 0,
		anchors: {},
		animations: { idle: ['m0'] },
		fps: {},
		colors: { z: [11, 22, 33, 255] },
		frames: [
			{
				name: 'm0',
				rows: ['██', '██'],
				colors: ['zz', 'zz'],
				bg: ['  ', '  '],
				anchors: {},
			},
		],
	};
}

function firstGlyph(buf: FakeBuffer, ch: string): Cell | undefined {
	for (const cell of buf.cells.values()) if (cell.ch === ch) return cell;
	return undefined;
}

test('styleWithLocalColors merges custom keys; local wins; empty is a no-op', () => {
	// No customs ⇒ same reference, nothing allocated.
	expect(
		styleWithLocalColors(STYLE, {}, (r, g, b, a) => `${r},${g},${b},${a}`),
	).toBe(STYLE);
	const merged = styleWithLocalColors(
		STYLE,
		{ z: [11, 22, 33, 255], w: [1, 2, 3, 255] },
		(r, g, b, a) => `${r},${g},${b},${a}`,
	);
	// A brand-new key is added…
	expect(merged.palette.z).toBe('11,22,33,255');
	// …and a file-local override of a global key wins over the scene palette.
	expect(merged.palette.w).toBe('1,2,3,255');
	expect(merged.palette.w).not.toBe(STYLE.palette.w);
	// The base style is untouched.
	expect(STYLE.palette.z).toBeUndefined();
});

test('file-local colours render in the composite once merged into the style (#393)', () => {
	const doc = localColorDoc();
	const W = 24;
	const H = 16;
	const view = { facing: 1 as const, stance: 'idle', elapsedS: 0 };

	// Base style: the file-local key 'z' is absent from the scene palette, so the
	// renderer falls through to paletteDefault — today's bug, the preview lies.
	const fallback = new FakeBuffer(W, H);
	expect(renderComposite(fallback, doc, 'monster', STYLE, view)).toBe(true);

	// Merged style: the doc's local colour is injected, so 'z' renders its real RGBA.
	const merged = styleWithLocalColors(
		STYLE,
		doc.colors,
		(r, g, b, a) => `${r},${g},${b},${a}`,
	);
	const faithful = new FakeBuffer(W, H);
	expect(renderComposite(faithful, doc, 'monster', merged, view)).toBe(true);

	// The art lands in both (same glyphs, same positions) — only the colour differs.
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

// --- session dynamic variant → composite agreement (spec #401 amendment) ----

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
