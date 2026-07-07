import type { Terrain } from './types';

// Terrain cell kinds (ADR 0026). A wall is fully solid (blocks every side); a
// one-way platform is solid to LAND on from above / pass through from below like any
// solid, but HORIZONTALLY transparent so a body rising through it isn't halted.
export const CELL = { empty: 0, wall: 1, platform: 2 } as const;

// The single glyph↔cell table shared by every terrain reader/writer, so `parseTerrain`,
// `parseZone`, and the forge serializer can't drift on what `#`/`=` mean.
// `terrainCell` returns the cell for a terrain glyph, or `undefined` when `ch` is not
// terrain at all (an entity anchor the caller resolves separately). `.`/space are empty.
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

// Vertically solid: a body lands on either a wall or a platform (both stop a
// descending body, per the global one-way rule in physics.ts, #262). Out of
// horizontal bounds and below the world read solid; above the world is open sky.
export function isSolid(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] !== CELL.empty;
}

// Horizontally solid: only WALLS block left/right motion. A one-way platform is
// skipped here so a body sliding sideways while it rises through a platform keeps its
// horizontal velocity (ADR 0026, Bug 2). The world bounds are walls too, so a Player
// can never leave the Zone sideways.
export function isWall(t: Terrain, cx: number, cy: number): boolean {
	if (cx < 0 || cx >= t.w) return true;
	if (cy < 0) return false;
	if (cy >= t.h) return true;
	return t.cells[cy * t.w + cx] === CELL.wall;
}

/**
 * ASCII tilemap: `#` = wall, `=` = one-way platform (ADR 0026), anything else = empty.
 * Rows pad to the widest. Sibling to `parseZone`'s grid parse — both go through
 * `terrainCell`, so a `.zone` and a hand-authored test map agree on every glyph.
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
