import { GROUND_TOP, WORLD } from '../src/constants';
import { parseTerrain } from '../src/terrain';
import type { Terrain } from '../src/types';

/**
 * A flat field: a full solid floor from GROUND_TOP down, open sky above. The
 * factory `makeStarterField` (with its seeded platforms) is gone (ADR 0008); the
 * combat/physics seam tests only ever needed *some* ground at GROUND_TOP, so this
 * is the minimal deterministic terrain to stand Avatars and Monsters on.
 */
export function flatTerrain(w = WORLD.w, h = WORLD.h): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < h; y++)
		rows.push((y >= GROUND_TOP ? '#' : '.').repeat(w));
	return parseTerrain(rows);
}
