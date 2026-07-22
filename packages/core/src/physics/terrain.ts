import type { Terrain } from '../entities/types';

export const CELL = { empty: 0, wall: 1, platform: 2 } as const;

export function terrainCell(ch: string): number | undefined {
	if (ch === '#') return CELL.wall;
	if (ch === '=') return CELL.platform;
	if (ch === '.' || ch === ' ') return CELL.empty;
	return undefined;
}

export function cellGlyph(cell: number): string {
	return cell === CELL.wall ? '#' : cell === CELL.platform ? '=' : '.';
}

export function isSolid(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] !== CELL.empty;
}

export function isWall(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] === CELL.wall;
}

export function parseTerrain(rows: string[]): Terrain {
	const h = rows.length;
	const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const cells = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < rows[y].length; x++) {
			const cell = terrainCell(rows[y][x]);
			if (cell) cells[y * w + x] = cell;
		}
	return { w, h, cells };
}
