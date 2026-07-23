import { glyphFromQuadrants } from '../quadrant';
import {
	compositeOver,
	compositeOverInto,
	type MutableRGBA,
	type RGBA,
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

/**
 * Caller-owned scratch a composed cell is decoded into on the allocation-light
 * read path ({@link Compositor.readCellInto}). Its `fg`/`bg` are overwritten in
 * place every read, so one instance serves an entire frame encode without
 * allocating per cell. `wide` is `undefined` unless the cell is a wide
 * grapheme's lead/continuation.
 */
export interface CellOut {
	char: string;
	fg: MutableRGBA;
	bg: MutableRGBA;
	wide: WideMark | undefined;
}

/** A fresh {@link CellOut} to reuse across an entire frame encode. */
export function createCellOut(): CellOut {
	return { char: ' ', fg: [0, 0, 0, 0], bg: [0, 0, 0, 0], wide: undefined };
}

/** Sub-pixel bit within a cell: bit = localX + 2 * localY (matches quadrant masks). */
const NONE = -1;

/** Wide-glyph role stored per cell (0 none, 1 lead, 2 continuation). */
const WIDE_NONE = 0;
const WIDE_LEAD = 1;
const WIDE_CONT = 2;

/**
 * Approximate fraction of a cell a glyph's foreground ink covers, used to
 * flatten a glyph into the Pixel remnant it leaves beneath itself. Blocks and
 * shades are exact; every other glyph assumes half coverage.
 */
const GLYPH_COVERAGE: Record<string, number> = {
	' ': 0,
	'█': 1,
	'▓': 0.75,
	'▒': 0.5,
	'░': 0.25,
	'▀': 0.5,
	'▄': 0.5,
	'▌': 0.5,
	'▐': 0.5,
	'▚': 0.5,
	'▞': 0.5,
	'▘': 0.25,
	'▝': 0.25,
	'▖': 0.25,
	'▗': 0.25,
	'▙': 0.75,
	'▛': 0.75,
	'▜': 0.75,
	'▟': 0.75,
};

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

	/**
	 * Per-read scratch for the allocation-light path: the four sub-pixel byte
	 * offsets and submission orders of the cell under inspection, plus the
	 * distinct-colour grouping (representative quad, order accumulator). A cell
	 * has exactly four quadrants, so four slots suffice. Reused every read so a
	 * whole frame reduces without allocating.
	 */
	private readonly quadOff = new Int32Array(4);
	private readonly quadOrder = new Int32Array(4);
	private readonly distRep = new Int32Array(4);
	private readonly distOrder = new Int32Array(4);
	private readonly distCount = new Int32Array(4);
	/** Backdrop scratch for the stamp path's dominant-coverage derivation. */
	private readonly scratchBackdrop: MutableRGBA = [0, 0, 0, 0];
	/** Scratch pair for the stamp path's flattened glyph remnant. */
	private readonly scratchInkFg: MutableRGBA = [0, 0, 0, 0];
	private readonly scratchRemnant: MutableRGBA = [0, 0, 0, 0];
	/** Cell scratch backing the object-returning {@link cell}/{@link surface}. */
	private readonly scratchOut = createCellOut();

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
		let backdrop: RGBA;
		if (bg) {
			backdrop = bg;
		} else {
			this.dominantBackdropInto(cellX, cellY, this.scratchBackdrop);
			backdrop = this.scratchBackdrop;
		}
		// The glyph is atomic: flatten the Pixels beneath to its remnant so later
		// Pixels composite against it and cover only their own sub-cells.
		this.flattenCell(
			cellX,
			cellY,
			this.glyphRemnant(char, fg, backdrop),
			order,
		);

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

		let leadBg: RGBA;
		if (bg) {
			leadBg = bg;
		} else {
			this.dominantBackdropInto(cellX, cellY, this.scratchBackdrop);
			leadBg = this.scratchBackdrop;
		}
		this.flattenCell(
			cellX,
			cellY,
			this.glyphRemnant(grapheme, fg, leadBg),
			leadOrder,
		);
		const li = cellY * this.widthCells + cellX;
		this.glyphChar[li] = grapheme;
		this.writeColor(this.glyphFg, li, fg);
		this.writeColor(this.glyphBg, li, leadBg);
		this.glyphOrder[li] = leadOrder;
		this.glyphWide[li] = WIDE_LEAD;

		let contBg: RGBA;
		if (bg) {
			contBg = bg;
		} else {
			this.dominantBackdropInto(cellX + 1, cellY, this.scratchBackdrop);
			contBg = this.scratchBackdrop;
		}
		// The continuation cell is visually covered by the wide glyph's right half,
		// so it flattens to the same remnant as the lead.
		this.flattenCell(
			cellX + 1,
			cellY,
			this.glyphRemnant(grapheme, fg, contBg),
			contOrder,
		);
		const ri = cellY * this.widthCells + cellX + 1;
		this.glyphChar[ri] = ' ';
		this.writeColor(this.glyphFg, ri, fg);
		this.writeColor(this.glyphBg, ri, contBg);
		this.glyphOrder[ri] = contOrder;
		this.glyphWide[ri] = WIDE_CONT;
	}

	/** Finished terminal-neutral cell at cell coords. Throws if out of bounds. */
	cell(cellX: number, cellY: number): Cell {
		this.readCellInto(cellX, cellY, this.scratchOut);
		return cellFromOut(this.scratchOut);
	}

	/** The whole surface as row-major rows of cells. */
	surface(): Cell[][] {
		const rows: Cell[][] = [];
		for (let cy = 0; cy < this.heightCells; cy++) {
			const row: Cell[] = [];
			for (let cx = 0; cx < this.widthCells; cx++) {
				this.readCellInto(cx, cy, this.scratchOut);
				row.push(cellFromOut(this.scratchOut));
			}
			rows.push(row);
		}
		return rows;
	}

	/**
	 * Allocation-light read: decode the composed cell at `(cellX, cellY)` into the
	 * caller's `out` (glyph + fg + bg + wide written in place, never allocating).
	 * This is the per-frame encode form — one `out` is reused across the whole
	 * surface, so a frame decode allocates nothing while {@link cell}/{@link
	 * surface} keep returning fresh objects atop it. Byte-identical to {@link
	 * cell}. Throws if out of bounds.
	 */
	readCellInto(cellX: number, cellY: number, out: CellOut): void {
		if (
			cellX < 0 ||
			cellX >= this.widthCells ||
			cellY < 0 ||
			cellY >= this.heightCells
		) {
			throw new RangeError(`cell (${cellX}, ${cellY}) is out of bounds`);
		}
		this.loadQuads(cellX, cellY);
		const ci = cellY * this.widthCells + cellX;
		const gOrder = this.glyphOrder[ci];
		if (gOrder !== NONE) {
			let maxPix = NONE;
			for (let quad = 0; quad < 4; quad++) {
				const o = this.quadOrder[quad];
				if (o > maxPix) maxPix = o;
			}
			// Frontmost representation owns the cell. No Pixel drawn after the glyph
			// ⇒ the glyph overlay wins, over its own flattened backdrop.
			if (maxPix <= gOrder) {
				out.char = this.glyphChar[ci] as string;
				this.copyStore(this.glyphFg, ci, out.fg);
				this.copyStore(this.glyphBg, ci, out.bg);
				const wide = this.glyphWide[ci];
				out.wide =
					wide === WIDE_LEAD ? 'lead' : wide === WIDE_CONT ? 'cont' : undefined;
				return;
			}
		}
		this.reduceInto(out);
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

	/**
	 * The flattened colour a glyph leaves in the Pixels beneath it: its foreground
	 * at its ink coverage over its backdrop, approximating the glyph's rendered
	 * look. Front Pixels drawn later reveal this remnant instead of the bare
	 * backdrop — an actor crossing a portal shows the portal colour, not the sky
	 * behind it. A blank glyph covers nothing and leaves the backdrop itself.
	 */
	private glyphRemnant(char: string, fg: RGBA, backdrop: RGBA): RGBA {
		const coverage = GLYPH_COVERAGE[char] ?? 0.5;
		if (coverage === 0) return backdrop;
		this.scratchInkFg[0] = fg[0];
		this.scratchInkFg[1] = fg[1];
		this.scratchInkFg[2] = fg[2];
		this.scratchInkFg[3] = Math.round(fg[3] * coverage);
		compositeOverInto(this.scratchInkFg, backdrop, this.scratchRemnant);
		return this.scratchRemnant;
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

	/** Cache the four sub-pixel byte offsets and orders of a cell into scratch. */
	private loadQuads(cellX: number, cellY: number): void {
		const baseX = cellX * 2;
		const baseY = cellY * 2;
		for (let quad = 0; quad < 4; quad++) {
			const lx = quad & 1;
			const ly = (quad >> 1) & 1;
			const si = (baseY + ly) * this.subW + (baseX + lx);
			this.quadOff[quad] = si * 4;
			this.quadOrder[quad] = this.pixelOrder[si];
		}
	}

	/**
	 * Derive the dominant-coverage backdrop of a cell into `out` (allocation-free
	 * mirror of the former `dominantBackdrop`): the colour covering the most
	 * sub-pixels, ties to the rearmost then stable RGBA. Assumes nothing — loads
	 * its own quads. Transparent when no sub-pixel is opaque.
	 */
	private dominantBackdropInto(
		cellX: number,
		cellY: number,
		out: MutableRGBA,
	): void {
		this.loadQuads(cellX, cellY);
		const p = this.pixels;
		let n = 0;
		for (let quad = 0; quad < 4; quad++) {
			const off = this.quadOff[quad];
			if (p[off + 3] === 0) continue; // transparent sub-pixels cover nothing
			const order = this.quadOrder[quad];
			let found = -1;
			for (let j = 0; j < n; j++) {
				if (this.pixelsEqual(off, this.quadOff[this.distRep[j]])) {
					found = j;
					break;
				}
			}
			if (found >= 0) {
				this.distCount[found]++;
				if (order < this.distOrder[found]) this.distOrder[found] = order;
			} else {
				this.distRep[n] = quad;
				this.distCount[n] = 1;
				this.distOrder[n] = order;
				n++;
			}
		}
		if (n === 0) {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			out[3] = 0;
			return;
		}
		let best = 0;
		for (let j = 1; j < n; j++) {
			if (this.distCount[j] > this.distCount[best]) {
				best = j;
			} else if (this.distCount[j] === this.distCount[best]) {
				// Equal coverage prefers the rearmost colour, then stable RGBA order.
				if (
					this.distOrder[j] < this.distOrder[best] ||
					(this.distOrder[j] === this.distOrder[best] &&
						this.pixelsCompare(
							this.quadOff[this.distRep[j]],
							this.quadOff[this.distRep[best]],
						) < 0)
				) {
					best = j;
				}
			}
		}
		this.copyPixels(this.quadOff[this.distRep[best]], out);
	}

	/**
	 * Reduce the four already-loaded quadrant Pixels into `out` (allocation-free
	 * mirror of the former `reducePixels`): one colour ⇒ full block or empty; two
	 * or more ⇒ the two frontmost distinct colours (recency, then stable RGBA)
	 * with a quadrant glyph mapping each sub-pixel to the nearer survivor.
	 */
	private reduceInto(out: CellOut): void {
		const p = this.pixels;
		let n = 0;
		for (let quad = 0; quad < 4; quad++) {
			const off = this.quadOff[quad];
			const order = this.quadOrder[quad];
			let found = -1;
			for (let j = 0; j < n; j++) {
				if (this.pixelsEqual(off, this.quadOff[this.distRep[j]])) {
					found = j;
					break;
				}
			}
			if (found >= 0) {
				if (order > this.distOrder[found]) this.distOrder[found] = order;
			} else {
				this.distRep[n] = quad;
				this.distOrder[n] = order;
				n++;
			}
		}

		out.wide = undefined;
		if (n === 1) {
			const off = this.quadOff[this.distRep[0]];
			if (p[off + 3] === 0) {
				out.char = ' ';
				out.fg[0] = 0;
				out.fg[1] = 0;
				out.fg[2] = 0;
				out.fg[3] = 0;
				out.bg[0] = 0;
				out.bg[1] = 0;
				out.bg[2] = 0;
				out.bg[3] = 0;
				return;
			}
			out.char = '█';
			this.copyPixels(off, out.fg);
			this.copyPixels(off, out.bg);
			return;
		}

		// An exposed transparent quadrant is the scene backdrop showing through: it
		// always survives as the background, so an empty quadrant never adopts a
		// nearby opaque colour (a foot's air neighbour must read as sky, not
		// ground). Otherwise survivors are the two frontmost distinct colours (most
		// recently written); stable RGBA order breaks any recency tie. Select
		// directly rather than sorting, so nothing is allocated.
		let transparentIdx = -1;
		for (let j = 0; j < n; j++) {
			if (p[this.quadOff[this.distRep[j]] + 3] === 0) {
				transparentIdx = j;
				break;
			}
		}
		let fgIdx = -1;
		for (let j = 0; j < n; j++) {
			if (j === transparentIdx) continue;
			if (fgIdx < 0 || this.distBetter(j, fgIdx)) fgIdx = j;
		}
		let bgIdx = transparentIdx;
		if (bgIdx < 0) {
			for (let j = 0; j < n; j++) {
				if (j === fgIdx) continue;
				if (bgIdx < 0 || this.distBetter(j, bgIdx)) bgIdx = j;
			}
		}
		const fgOff = this.quadOff[this.distRep[fgIdx]];
		const bgOff = this.quadOff[this.distRep[bgIdx]];

		let mask = 0;
		for (let quad = 0; quad < 4; quad++) {
			if (this.mapsToForegroundAt(this.quadOff[quad], fgOff, bgOff))
				mask |= 1 << quad;
		}
		out.char = glyphFromQuadrants(mask);
		this.copyPixels(fgOff, out.fg);
		this.copyPixels(bgOff, out.bg);
	}

	/** distinct[a] outranks distinct[b] (order desc, then stable RGBA asc). */
	private distBetter(a: number, b: number): boolean {
		const oa = this.distOrder[a];
		const ob = this.distOrder[b];
		if (oa !== ob) return oa > ob;
		return (
			this.pixelsCompare(
				this.quadOff[this.distRep[a]],
				this.quadOff[this.distRep[b]],
			) < 0
		);
	}

	private mapsToForegroundAt(
		pcOff: number,
		fgOff: number,
		bgOff: number,
	): boolean {
		if (this.pixelsEqual(pcOff, fgOff)) return true;
		if (this.pixelsEqual(pcOff, bgOff)) return false;
		const df = this.pixelsSqDist(pcOff, fgOff);
		const db = this.pixelsSqDist(pcOff, bgOff);
		if (df !== db) return df < db;
		// Equal distance: map to whichever survivor is smaller in stable RGBA order.
		return this.pixelsCompare(fgOff, bgOff) <= 0;
	}

	/** Equal RGBA of two sub-pixels by byte offset in the flat store. */
	private pixelsEqual(o1: number, o2: number): boolean {
		const p = this.pixels;
		return (
			p[o1] === p[o2] &&
			p[o1 + 1] === p[o2 + 1] &&
			p[o1 + 2] === p[o2 + 2] &&
			p[o1 + 3] === p[o2 + 3]
		);
	}

	/** Lexicographic RGBA order of two sub-pixels by byte offset. */
	private pixelsCompare(o1: number, o2: number): number {
		const p = this.pixels;
		if (p[o1] !== p[o2]) return p[o1] - p[o2];
		if (p[o1 + 1] !== p[o2 + 1]) return p[o1 + 1] - p[o2 + 1];
		if (p[o1 + 2] !== p[o2 + 2]) return p[o1 + 2] - p[o2 + 2];
		return p[o1 + 3] - p[o2 + 3];
	}

	/** Squared RGB distance of two sub-pixels by byte offset. */
	private pixelsSqDist(o1: number, o2: number): number {
		const p = this.pixels;
		const dr = p[o1] - p[o2];
		const dg = p[o1 + 1] - p[o2 + 1];
		const db = p[o1 + 2] - p[o2 + 2];
		return dr * dr + dg * dg + db * db;
	}

	/** Copy one sub-pixel colour (by byte offset) into a caller-owned RGBA. */
	private copyPixels(off: number, out: MutableRGBA): void {
		out[0] = this.pixels[off];
		out[1] = this.pixels[off + 1];
		out[2] = this.pixels[off + 2];
		out[3] = this.pixels[off + 3];
	}

	/** Copy a per-cell store colour (by cell index) into a caller-owned RGBA. */
	private copyStore(
		store: Uint8ClampedArray,
		index: number,
		out: MutableRGBA,
	): void {
		const off = index * 4;
		out[0] = store[off];
		out[1] = store[off + 1];
		out[2] = store[off + 2];
		out[3] = store[off + 3];
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
}

/** Freeze an allocation-light {@link CellOut} into an immutable {@link Cell}. */
function cellFromOut(out: CellOut): Cell {
	return {
		char: out.char,
		fg: [out.fg[0], out.fg[1], out.fg[2], out.fg[3]],
		bg: [out.bg[0], out.bg[1], out.bg[2], out.bg[3]],
		...(out.wide ? { wide: out.wide } : {}),
	};
}
