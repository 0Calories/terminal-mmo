import { glyphFromQuadrants } from '../quadrant';
import {
	compareRGBA,
	compositeOver,
	equalRGBA,
	type RGBA,
	sqDistRGB,
	TRANSPARENT,
} from './rgba';

/**
 * How a cell participates in a two-column grapheme (dynamic world text only):
 * `lead` carries the wide glyph and owns both columns; `cont` is the trailing
 * cell the terminal already covers, so the encoder blanks it.
 */
export type WideMark = 'lead' | 'cont';

/** A finished terminal-neutral cell: one glyph over exactly two colours. */
export interface Cell {
	readonly char: string;
	readonly fg: RGBA;
	readonly bg: RGBA;
	readonly wide?: WideMark;
}

const EMPTY_CELL: Cell = { char: ' ', fg: TRANSPARENT, bg: TRANSPARENT };

/** Sub-pixel bit within a cell: bit = localX + 2 * localY (matches quadrant masks). */
const NONE = -1;

/** Wide-glyph role stored per cell (0 none, 1 lead, 2 continuation). */
const WIDE_NONE = 0;
const WIDE_LEAD = 1;
const WIDE_CONT = 2;

function assertPositiveInt(name: string, value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer, got ${value}`);
	}
}

/**
 * Composes ordered RGBA Pixel and Glyph primitives into deterministic,
 * terminal-neutral cells (ADR 0038). Each terminal cell is backed by four
 * sub-cell Pixels stored in flat, reusable typed-array buffers; no per-Pixel
 * object is allocated. Every write is clipped to bounds. Output cells are the
 * only observable surface.
 */
export class Compositor {
	readonly widthCells: number;
	readonly heightCells: number;

	private readonly subW: number;
	private readonly subH: number;

	/** Flat sub-pixel colour store: 4 bytes (r,g,b,a) per sub-pixel, row-major. */
	private readonly pixels: Uint8ClampedArray;
	/** Submission index of the topmost contributor to each sub-pixel (or NONE). */
	private readonly pixelOrder: Int32Array;

	/** Per-cell glyph overlay (null char ⇒ derive the cell from its Pixels). */
	private readonly glyphChar: (string | null)[];
	private readonly glyphFg: Uint8ClampedArray;
	/** Per-cell flattened glyph backdrop (authored bg, else dominant coverage). */
	private readonly glyphBg: Uint8ClampedArray;
	private readonly glyphOrder: Int32Array;
	/** Wide-glyph role per cell: WIDE_NONE, WIDE_LEAD, or WIDE_CONT. */
	private readonly glyphWide: Uint8Array;

	private seq = 0;

	constructor(widthCells: number, heightCells: number) {
		assertPositiveInt('widthCells', widthCells);
		assertPositiveInt('heightCells', heightCells);
		this.widthCells = widthCells;
		this.heightCells = heightCells;
		this.subW = widthCells * 2;
		this.subH = heightCells * 2;

		const subCount = this.subW * this.subH;
		const cellCount = widthCells * heightCells;
		this.pixels = new Uint8ClampedArray(subCount * 4);
		this.pixelOrder = new Int32Array(subCount);
		this.glyphChar = new Array<string | null>(cellCount);
		this.glyphFg = new Uint8ClampedArray(cellCount * 4);
		this.glyphBg = new Uint8ClampedArray(cellCount * 4);
		this.glyphOrder = new Int32Array(cellCount);
		this.glyphWide = new Uint8Array(cellCount);
		this.clear();
	}

	/** Reset every buffer to empty, reusing the existing allocations. */
	clear(): void {
		this.pixels.fill(0);
		this.pixelOrder.fill(NONE);
		this.glyphChar.fill(null);
		this.glyphFg.fill(0);
		this.glyphBg.fill(0);
		this.glyphOrder.fill(NONE);
		this.glyphWide.fill(WIDE_NONE);
		this.seq = 0;
	}

	/** Alias for {@link clear}. */
	reset(): void {
		this.clear();
	}

	/** Source-over composite one sub-cell Pixel at pixel coords. Clipped. */
	setPixel(px: number, py: number, color: RGBA): void {
		const order = this.seq++;
		this.writePixel(px, py, color, order);
	}

	/** Fill a rectangle of sub-cell Pixels (source-over per pixel). Clipped. */
	fillPixelRect(
		px: number,
		py: number,
		w: number,
		h: number,
		color: RGBA,
	): void {
		const order = this.seq++;
		const x0 = Math.max(0, px);
		const y0 = Math.max(0, py);
		const x1 = Math.min(this.subW, px + w);
		const y1 = Math.min(this.subH, py + h);
		for (let y = y0; y < y1; y++) {
			for (let x = x0; x < x1; x++) this.writePixel(x, y, color, order);
		}
	}

	/**
	 * Stamp one atomic terminal cell. Without `bg`, the backdrop is derived from
	 * the composed Pixels beneath (colour covering the most sub-pixels; ties go
	 * rearmost then stable RGBA). An authored `bg` stays opaque. Clipped.
	 */
	stampGlyph(
		cellX: number,
		cellY: number,
		char: string,
		fg: RGBA,
		bg?: RGBA,
	): void {
		const order = this.seq++;
		if (
			cellX < 0 ||
			cellX >= this.widthCells ||
			cellY < 0 ||
			cellY >= this.heightCells
		) {
			return;
		}
		const backdrop = bg ?? this.dominantBackdrop(cellX, cellY);
		// The glyph is atomic: flatten the Pixels beneath to its backdrop so later
		// Pixels composite against it and cover only their own sub-cells.
		this.flattenCell(cellX, cellY, backdrop, order);

		const ci = cellY * this.widthCells + cellX;
		this.glyphChar[ci] = char;
		this.writeColor(this.glyphFg, ci, fg);
		this.writeColor(this.glyphBg, ci, backdrop);
		this.glyphOrder[ci] = order;
		this.glyphWide[ci] = WIDE_NONE;
	}

	/**
	 * Stamp a two-column grapheme as one atomic overlay across cell X and X+1
	 * (ADR 0038: dynamic world text is display-width-aware). The lead cell carries
	 * the grapheme; the continuation cell is blanked so the terminal renders the
	 * wide glyph once and the neighbour is never a stray half. If the pair would
	 * straddle the right edge (only the first column fits), the whole grapheme is
	 * dropped so no partial output remains. Clipped.
	 */
	stampWideGlyph(
		cellX: number,
		cellY: number,
		grapheme: string,
		fg: RGBA,
		bg?: RGBA,
	): void {
		if (cellY < 0 || cellY >= this.heightCells) return;
		// Atomic clip: both columns must fit, else emit nothing.
		if (cellX < 0 || cellX + 1 >= this.widthCells) return;

		const leadOrder = this.seq++;
		const contOrder = this.seq++;

		const leadBg = bg ?? this.dominantBackdrop(cellX, cellY);
		this.flattenCell(cellX, cellY, leadBg, leadOrder);
		const li = cellY * this.widthCells + cellX;
		this.glyphChar[li] = grapheme;
		this.writeColor(this.glyphFg, li, fg);
		this.writeColor(this.glyphBg, li, leadBg);
		this.glyphOrder[li] = leadOrder;
		this.glyphWide[li] = WIDE_LEAD;

		const contBg = bg ?? this.dominantBackdrop(cellX + 1, cellY);
		this.flattenCell(cellX + 1, cellY, contBg, contOrder);
		const ri = cellY * this.widthCells + cellX + 1;
		this.glyphChar[ri] = ' ';
		this.writeColor(this.glyphFg, ri, fg);
		this.writeColor(this.glyphBg, ri, contBg);
		this.glyphOrder[ri] = contOrder;
		this.glyphWide[ri] = WIDE_CONT;
	}

	/** Finished terminal-neutral cell at cell coords. Throws if out of bounds. */
	cell(cellX: number, cellY: number): Cell {
		if (
			cellX < 0 ||
			cellX >= this.widthCells ||
			cellY < 0 ||
			cellY >= this.heightCells
		) {
			throw new RangeError(`cell (${cellX}, ${cellY}) is out of bounds`);
		}
		return this.computeCell(cellX, cellY);
	}

	/** The whole surface as row-major rows of cells. */
	surface(): Cell[][] {
		const rows: Cell[][] = [];
		for (let cy = 0; cy < this.heightCells; cy++) {
			const row: Cell[] = [];
			for (let cx = 0; cx < this.widthCells; cx++)
				row.push(this.computeCell(cx, cy));
			rows.push(row);
		}
		return rows;
	}

	private writePixel(px: number, py: number, color: RGBA, order: number): void {
		if (px < 0 || px >= this.subW || py < 0 || py >= this.subH) return;
		// A fully transparent write is identity: it contributes nothing and must
		// not become the topmost contributor.
		if (color[3] === 0) return;
		const si = py * this.subW + px;
		const off = si * 4;
		const dst: RGBA = [
			this.pixels[off],
			this.pixels[off + 1],
			this.pixels[off + 2],
			this.pixels[off + 3],
		];
		const out = compositeOver(color, dst);
		this.pixels[off] = out[0];
		this.pixels[off + 1] = out[1];
		this.pixels[off + 2] = out[2];
		this.pixels[off + 3] = out[3];
		this.pixelOrder[si] = order;
	}

	private flattenCell(
		cellX: number,
		cellY: number,
		color: RGBA,
		order: number,
	): void {
		for (let ly = 0; ly < 2; ly++) {
			for (let lx = 0; lx < 2; lx++) {
				const si = (cellY * 2 + ly) * this.subW + (cellX * 2 + lx);
				const off = si * 4;
				this.pixels[off] = color[0];
				this.pixels[off + 1] = color[1];
				this.pixels[off + 2] = color[2];
				this.pixels[off + 3] = color[3];
				this.pixelOrder[si] = order;
			}
		}
	}

	private cellPixel(cellX: number, cellY: number, quad: number): RGBA {
		const lx = quad & 1;
		const ly = (quad >> 1) & 1;
		const off = ((cellY * 2 + ly) * this.subW + (cellX * 2 + lx)) * 4;
		return [
			this.pixels[off],
			this.pixels[off + 1],
			this.pixels[off + 2],
			this.pixels[off + 3],
		];
	}

	private cellPixelOrder(cellX: number, cellY: number, quad: number): number {
		const lx = quad & 1;
		const ly = (quad >> 1) & 1;
		return this.pixelOrder[(cellY * 2 + ly) * this.subW + (cellX * 2 + lx)];
	}

	private dominantBackdrop(cellX: number, cellY: number): RGBA {
		const groups: { color: RGBA; count: number; rearOrder: number }[] = [];
		for (let quad = 0; quad < 4; quad++) {
			const color = this.cellPixel(cellX, cellY, quad);
			if (color[3] === 0) continue; // transparent sub-pixels cover nothing
			const order = this.cellPixelOrder(cellX, cellY, quad);
			const g = groups.find((it) => equalRGBA(it.color, color));
			if (g) {
				g.count++;
				if (order < g.rearOrder) g.rearOrder = order;
			} else {
				groups.push({ color, count: 1, rearOrder: order });
			}
		}
		if (groups.length === 0) return TRANSPARENT;
		let best = groups[0];
		for (let i = 1; i < groups.length; i++) {
			const g = groups[i];
			if (g.count > best.count) {
				best = g;
			} else if (g.count === best.count) {
				// Equal coverage prefers the rearmost colour, then stable RGBA order.
				if (
					g.rearOrder < best.rearOrder ||
					(g.rearOrder === best.rearOrder &&
						compareRGBA(g.color, best.color) < 0)
				) {
					best = g;
				}
			}
		}
		return best.color;
	}

	private computeCell(cellX: number, cellY: number): Cell {
		const ci = cellY * this.widthCells + cellX;
		const gOrder = this.glyphOrder[ci];
		if (gOrder !== NONE) {
			let maxPix = NONE;
			for (let quad = 0; quad < 4; quad++) {
				const o = this.cellPixelOrder(cellX, cellY, quad);
				if (o > maxPix) maxPix = o;
			}
			// Frontmost representation owns the cell. No Pixel drawn after the glyph
			// ⇒ the glyph overlay wins, over its own flattened backdrop.
			if (maxPix <= gOrder) {
				const wide = this.glyphWide[ci];
				return {
					char: this.glyphChar[ci] as string,
					fg: this.readColor(this.glyphFg, ci),
					bg: this.readColor(this.glyphBg, ci),
					...(wide === WIDE_LEAD
						? { wide: 'lead' as const }
						: wide === WIDE_CONT
							? { wide: 'cont' as const }
							: {}),
				};
			}
		}
		return this.reducePixels(cellX, cellY);
	}

	private reducePixels(cellX: number, cellY: number): Cell {
		const colors: RGBA[] = [
			this.cellPixel(cellX, cellY, 0),
			this.cellPixel(cellX, cellY, 1),
			this.cellPixel(cellX, cellY, 2),
			this.cellPixel(cellX, cellY, 3),
		];
		const orders = [
			this.cellPixelOrder(cellX, cellY, 0),
			this.cellPixelOrder(cellX, cellY, 1),
			this.cellPixelOrder(cellX, cellY, 2),
			this.cellPixelOrder(cellX, cellY, 3),
		];

		const distinct: { color: RGBA; frontOrder: number }[] = [];
		for (let quad = 0; quad < 4; quad++) {
			const color = colors[quad];
			const order = orders[quad];
			const g = distinct.find((it) => equalRGBA(it.color, color));
			if (g) {
				if (order > g.frontOrder) g.frontOrder = order;
			} else {
				distinct.push({ color, frontOrder: order });
			}
		}

		if (distinct.length === 1) {
			const c = distinct[0].color;
			if (c[3] === 0) return EMPTY_CELL;
			return { char: '█', fg: c, bg: c };
		}

		// Survivors are the two frontmost distinct colours (most recently written);
		// stable RGBA order breaks any recency tie.
		distinct.sort((a, b) => {
			if (a.frontOrder !== b.frontOrder) return b.frontOrder - a.frontOrder;
			return compareRGBA(a.color, b.color);
		});
		const fg = distinct[0].color;
		const bg = distinct[1].color;

		let mask = 0;
		for (let quad = 0; quad < 4; quad++) {
			if (this.mapsToForeground(colors[quad], fg, bg)) mask |= 1 << quad;
		}
		return { char: glyphFromQuadrants(mask), fg, bg };
	}

	private mapsToForeground(pc: RGBA, fg: RGBA, bg: RGBA): boolean {
		if (equalRGBA(pc, fg)) return true;
		if (equalRGBA(pc, bg)) return false;
		const df = sqDistRGB(pc, fg);
		const db = sqDistRGB(pc, bg);
		if (df !== db) return df < db;
		// Equal distance: map to whichever survivor is smaller in stable RGBA order.
		return compareRGBA(fg, bg) <= 0;
	}

	private writeColor(
		store: Uint8ClampedArray,
		index: number,
		color: RGBA,
	): void {
		const off = index * 4;
		store[off] = color[0];
		store[off + 1] = color[1];
		store[off + 2] = color[2];
		store[off + 3] = color[3];
	}

	private readColor(store: Uint8ClampedArray, index: number): RGBA {
		const off = index * 4;
		return [store[off], store[off + 1], store[off + 2], store[off + 3]];
	}
}
