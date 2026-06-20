import { GROUND_TOP, TOWN, WORLD } from './constants';
import { rngNext } from './rng';
import type { Terrain } from './types';

/** A cell is solid if out of horizontal bounds (walls), below the world (floor),
 * or marked solid. Above the world is open sky. */
export function isSolid(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] === 1;
}

/** Parse an ASCII tilemap ('#' = solid, anything else = empty). Rows are padded
 * to the widest row. Handy for tests and hand-authored Zones. */
export function parseTerrain(rows: string[]): Terrain {
	const h = rows.length;
	const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const cells = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < rows[y].length; x++)
			if (rows[y][x] === '#') cells[y * w + x] = 1;
	return { w, h, cells };
}

/** Deterministic starter Field: full-width ground + scattered platforms. */
export function makeStarterField(seed = 1337): Terrain {
	const { w, h } = WORLD;
	const cells = new Uint8Array(w * h);
	for (let y = GROUND_TOP; y < h; y++)
		for (let x = 0; x < w; x++) cells[y * w + x] = 1;
	let s = seed;
	const next = () => {
		const r = rngNext(s);
		s = r.state;
		return r.value;
	};
	for (let i = 0; i < 70; i++) {
		const px = Math.floor(next() * (w - 16)) + 2;
		const py = GROUND_TOP - 4 - Math.floor(next() * 18);
		const len = 6 + Math.floor(next() * 12);
		for (let x = px; x < Math.min(px + len, w); x++) cells[py * w + x] = 1;
	}
	return { w, h, cells };
}

/** Hand-authored Town: a small, fully enclosed plaza — full-width ground, side
 * walls, and a low central dais to stand on. Deterministic (no RNG) and visually
 * distinct from the Field's scattered platforms (CONTEXT: Town — the safe hub). */
export function makeTownTerrain(): Terrain {
	const w = TOWN.w;
	const h = WORLD.h;
	const cells = new Uint8Array(w * h);
	const solid = (x: number, y: number) => {
		if (x >= 0 && x < w && y >= 0 && y < h) cells[y * w + x] = 1;
	};
	// ground floor across the whole plaza
	for (let y = GROUND_TOP; y < h; y++) for (let x = 0; x < w; x++) solid(x, y);
	// bounding side walls, floor to a few cells above ground
	for (let y = GROUND_TOP - 12; y < GROUND_TOP; y++) {
		solid(0, y);
		solid(w - 1, y);
	}
	// a low central dais (decorative, walkable) — a tidy focal point
	const daisY = GROUND_TOP - 3;
	for (let x = Math.floor(w / 2) - 6; x <= Math.floor(w / 2) + 6; x++)
		solid(x, daisY);
	return { w, h, cells };
}
