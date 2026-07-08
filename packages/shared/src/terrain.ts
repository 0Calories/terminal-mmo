import type { Terrain } from './types';

// Terrain cell kinds (ADR 0026). A wall is fully solid; a one-way platform lands from
// above but is horizontally transparent so a rising body isn't halted.
export const CELL = { empty: 0, wall: 1, platform: 2 } as const;

// The cell for a terrain glyph, or `undefined` when `ch` isn't terrain at all (an entity
// anchor the caller resolves separately). `.`/space are empty.
export function terrainCell(ch: string): number | undefined {
	if (ch === '#') return CELL.wall;
	if (ch === '=') return CELL.platform;
	if (ch === '.' || ch === ' ') return CELL.empty;
	return undefined;
}

/** Inverse of `terrainCell`: the glyph a cell serializes back to. */
export function cellGlyph(cell: number): string {
	return cell === CELL.wall ? '#' : cell === CELL.platform ? '=' : '.';
}

// Vertically solid: a body lands on a wall or platform. Out of horizontal bounds and
// below the world read solid; above the world is open sky (#262).
export function isSolid(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] !== CELL.empty;
}

// Horizontally solid: only WALLS block left/right motion, so a body rising through a
// platform keeps its horizontal velocity (ADR 0026). World bounds read as walls, so a
// Player can never leave the Zone sideways.
export function isWall(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] === CELL.wall;
}

/**
 * ASCII tilemap: `#` = wall, `=` = one-way platform (ADR 0026), anything else = empty.
 * Rows pad to the widest.
 */
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
