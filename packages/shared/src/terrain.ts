import type { Terrain } from './types';

// Out of horizontal bounds and below the world are solid; above the world is
// open sky.
export function isSolid(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] === 1;
}

/** ASCII tilemap: '#' = solid, anything else = empty. Rows pad to the widest. */
export function parseTerrain(rows: string[]): Terrain {
	const h = rows.length;
	const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const cells = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < rows[y].length; x++)
			if (rows[y][x] === '#') cells[y * w + x] = 1;
	return { w, h, cells };
}
