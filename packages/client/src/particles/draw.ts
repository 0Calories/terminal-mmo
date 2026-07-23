import type { Terrain } from '@mmo/core/entities';
import type { CellBuffer } from '@mmo/render';
import { RGBA } from '@opentui/core';
import { COLORS as C } from '../theme';
import { type Pool, speckColor, speckDrawCell, speckGlyph } from './engine';
import type { Speck } from './profile';

export function drawSpecks(
	buf: CellBuffer<RGBA>,
	pool: Pool,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
	keep: (p: Speck) => boolean,
): void {
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	for (const p of pool.specks) {
		if (!p.active || !keep(p)) continue;
		const { col, row } = speckDrawCell(p, terrain);
		const px = col - camX;
		const py = row - camY;
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const c = speckColor(p);
		buf.setCellWithAlphaBlending(
			px,
			py,
			speckGlyph(p),
			RGBA.fromInts(c.r, c.g, c.b, c.a),
			C.transparent,
		);
	}
}
