import { describe, expect, test } from 'bun:test';
import { Compositor, type RGBA } from '../src/compositor';

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const WHITE: RGBA = [255, 255, 255, 255];
const BLACK: RGBA = [0, 0, 0, 255];
const TRANSPARENT: RGBA = [0, 0, 0, 0];

function fillCell(c: Compositor, cx: number, cy: number, color: RGBA): void {
	c.fillPixelRect(cx * 2, cy * 2, 2, 2, color);
}

describe('law 1: transparent identity', () => {
	test('a fully-transparent pixel leaves what is beneath unchanged', () => {
		const c = new Compositor(1, 1);
		fillCell(c, 0, 0, RED);
		c.setPixel(0, 0, TRANSPARENT);
		c.setPixel(1, 1, TRANSPARENT);
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('█');
		expect(cell.fg).toEqual(RED);
		expect(cell.bg).toEqual(RED);
	});

	test('a transparent pixel does not become the frontmost contributor', () => {
		const c = new Compositor(1, 1);
		c.setPixel(0, 0, RED); // TL, order 0
		c.setPixel(1, 0, GREEN); // TR, order 1
		c.setPixel(0, 0, TRANSPARENT); // no-op, must not resurface TL as frontmost
		const cell = c.cell(0, 0);
		// GREEN is the frontmost real write, so it is the foreground survivor.
		expect(cell.fg).toEqual(GREEN);
	});
});

describe('law 2: opaque overwrite', () => {
	test('an opaque pixel fully replaces what is beneath (no blend)', () => {
		const c = new Compositor(1, 1);
		c.setPixel(0, 0, RED);
		c.setPixel(0, 0, BLUE);
		const cell = c.cell(0, 0);
		expect(cell.fg).toEqual(BLUE);
	});
});

describe('law 3: source-over alpha', () => {
	test('translucent over opaque blends with deterministic sRGB rounding', () => {
		const c = new Compositor(1, 1);
		fillCell(c, 0, 0, RED);
		fillCell(c, 0, 0, [0, 0, 255, 128]);
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('█');
		// 255*(1-128/255)=127 red, 255*(128/255)=128 blue, alpha stays 255.
		expect(cell.fg).toEqual([127, 0, 128, 255]);
	});
});

describe('law 4: two-colour reduction', () => {
	test('two frontmost colours survive; lower pixels map by squared-RGB distance', () => {
		const c = new Compositor(1, 1);
		const A: RGBA = [10, 10, 10, 255];
		const B: RGBA = [250, 250, 250, 255];
		c.setPixel(0, 0, A); // TL order 0 (near BLACK)
		c.setPixel(1, 0, B); // TR order 1 (near WHITE)
		c.setPixel(0, 1, BLACK); // BL order 2 survivor
		c.setPixel(1, 1, WHITE); // BR order 3 survivor (frontmost)
		const cell = c.cell(0, 0);
		expect(cell.fg).toEqual(WHITE);
		expect(cell.bg).toEqual(BLACK);
		// A->BLACK(bg), B->WHITE(fg,bit1), BLACK->bg, WHITE->fg(bit3): mask 2|8=10.
		expect(cell.char).toBe('▐');
	});

	test('equal distance breaks toward the smaller RGBA survivor', () => {
		const c = new Compositor(1, 1);
		const GRAY: RGBA = [100, 100, 100, 255];
		const MID: RGBA = [50, 50, 50, 255];
		c.setPixel(0, 0, MID); // TL order 0, equidistant to BLACK and GRAY
		c.setPixel(1, 0, GRAY); // TR order 1 survivor
		c.setPixel(0, 1, BLACK); // BL order 2 survivor
		c.setPixel(1, 1, BLACK); // BR order 3 (BLACK frontmost)
		const cell = c.cell(0, 0);
		expect(cell.fg).toEqual(BLACK);
		expect(cell.bg).toEqual(GRAY);
		// MID ties -> maps to smaller RGBA (BLACK/fg, bit0); GRAY->bg; BLACK->fg(4,8).
		expect(cell.char).toBe('▙');
	});
});

describe('law 5: glyph backdrop', () => {
	test('without authored bg, backdrop is the colour covering the most pixels', () => {
		const c = new Compositor(1, 1);
		c.setPixel(0, 0, RED);
		c.setPixel(1, 0, RED);
		c.setPixel(0, 1, RED);
		c.setPixel(1, 1, GREEN);
		c.stampGlyph(0, 0, 'A', WHITE);
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('A');
		expect(cell.fg).toEqual(WHITE);
		expect(cell.bg).toEqual(RED);
	});

	test('equal coverage prefers the rearmost colour', () => {
		const c = new Compositor(1, 1);
		c.setPixel(0, 0, RED); // order 0
		c.setPixel(1, 0, RED); // order 1
		c.setPixel(0, 1, BLUE); // order 2
		c.setPixel(1, 1, BLUE); // order 3
		c.stampGlyph(0, 0, 'B', WHITE);
		// 2 vs 2: rearmost group wins -> RED (orders 0,1) over BLUE (2,3).
		expect(c.cell(0, 0).bg).toEqual(RED);
	});

	test('an authored bg stays opaque and overrides coverage', () => {
		const c = new Compositor(1, 1);
		fillCell(c, 0, 0, RED);
		const authored: RGBA = [9, 9, 9, 255];
		c.stampGlyph(0, 0, 'X', WHITE, authored);
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('X');
		expect(cell.bg).toEqual(authored);
	});
});

describe('law 6: representation precedence', () => {
	test('a front glyph replaces lower pixels but keeps their flattened backdrop', () => {
		const c = new Compositor(1, 1);
		fillCell(c, 0, 0, GREEN);
		c.stampGlyph(0, 0, 'H', WHITE);
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('H');
		expect(cell.fg).toEqual(WHITE);
		expect(cell.bg).toEqual(GREEN);
	});

	test('front pixel content replaces a lower glyph, retaining its backdrop', () => {
		const c = new Compositor(1, 1);
		const backdrop: RGBA = [20, 20, 20, 255];
		c.stampGlyph(0, 0, 'H', WHITE, backdrop);
		c.setPixel(0, 0, RED); // drawn after the glyph -> pixels win
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('▘'); // TL foreground over the glyph backdrop
		expect(cell.fg).toEqual(RED);
		expect(cell.bg).toEqual(backdrop);
	});
});

describe('law 7: clipping and determinism', () => {
	test('out-of-bounds writes are ignored and never corrupt neighbours', () => {
		const c = new Compositor(2, 2);
		expect(() => {
			c.setPixel(-1, -1, RED);
			c.setPixel(999, 999, RED);
			c.fillPixelRect(-5, -5, 2, 2, RED);
			c.stampGlyph(-1, 0, 'Z', WHITE);
			c.stampGlyph(9, 9, 'Z', WHITE);
		}).not.toThrow();
		// fillPixelRect(-5,-5,2,2) clips to nothing; every cell stays empty.
		for (let cy = 0; cy < 2; cy++) {
			for (let cx = 0; cx < 2; cx++) {
				expect(c.cell(cx, cy)).toEqual({
					char: ' ',
					fg: TRANSPARENT,
					bg: TRANSPARENT,
				});
			}
		}
	});

	test('a partially out-of-bounds rect fills only the in-bounds pixels', () => {
		const c = new Compositor(1, 1);
		c.fillPixelRect(-1, -1, 2, 2, RED); // only sub-pixel (0,0) lands
		const cell = c.cell(0, 0);
		expect(cell.char).toBe('▘');
		expect(cell.fg).toEqual(RED);
	});

	test('cell() throws for out-of-bounds reads', () => {
		const c = new Compositor(1, 1);
		expect(() => c.cell(1, 0)).toThrow(RangeError);
		expect(() => c.cell(0, -1)).toThrow(RangeError);
	});

	test('identical primitive sequences yield identical surfaces', () => {
		const draw = (c: Compositor): void => {
			c.setPixel(0, 0, RED);
			c.fillPixelRect(1, 0, 3, 3, [0, 0, 255, 100]);
			c.setPixel(2, 2, GREEN);
			c.stampGlyph(1, 1, '@', WHITE);
			c.stampGlyph(0, 0, '#', BLACK, [7, 7, 7, 255]);
		};
		const a = new Compositor(2, 2);
		const b = new Compositor(2, 2);
		draw(a);
		draw(b);
		expect(a.surface()).toEqual(b.surface());
	});
});

describe('construction and reset', () => {
	test('rejects non-positive dimensions', () => {
		expect(() => new Compositor(0, 1)).toThrow(RangeError);
		expect(() => new Compositor(2, -1)).toThrow(RangeError);
		expect(() => new Compositor(1.5, 1)).toThrow(RangeError);
	});

	test('clear() reuses buffers and returns to an empty surface', () => {
		const c = new Compositor(1, 1);
		fillCell(c, 0, 0, RED);
		c.stampGlyph(0, 0, 'A', WHITE);
		c.clear();
		expect(c.cell(0, 0)).toEqual({
			char: ' ',
			fg: TRANSPARENT,
			bg: TRANSPARENT,
		});
	});
});
