import { BOX, type Drop, type Entity, SCENE_COLORS } from '@mmo/core/entities';
import { RARITY_COLOR } from '@mmo/core/items';
import type { Portal } from '@mmo/core/zones';
import type { Compositor, RGBA } from '../compositor';
import { spriteFor } from '../registry';

const PORTAL: RGBA = SCENE_COLORS.portal;

/**
 * Portal glyphs (ADR 0038, pass 2). A `▒` shade stamp with no authored
 * background derives its backdrop from the composed Terrain beneath — the
 * translucent portal look, never a guessed colour. Clipped by the compositor.
 */
export function drawPortals(
	compositor: Compositor,
	portals: readonly Portal[],
	cam: { x: number; y: number },
): void {
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	for (const pr of portals)
		for (let yy = 0; yy < pr.h; yy++)
			for (let xx = 0; xx < pr.w; xx++)
				compositor.stampGlyph(pr.x + xx - camX, pr.y + yy - camY, '▒', PORTAL);
}

/** Ground Drop glyphs coloured by rarity (ADR 0038, pass 2). Clipped. */
export function drawDrops(
	compositor: Compositor,
	drops: readonly Drop[],
	cam: { x: number; y: number },
): void {
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	for (const d of drops) {
		const col: RGBA = RARITY_COLOR[d.item.rarity];
		const gx = Math.round(d.x + d.w / 2) - camX;
		const gy = Math.round(d.y + d.h - 1) - camY;
		compositor.stampGlyph(gx, gy, '◆', col);
	}
}

const FADE_MS = 300;
const PEAK_ALPHA = 235;
const ECHO_RGB: readonly [number, number, number] = [150, 220, 255];

/** A drawable dodge after-image; the client tracker samples and ages these. */
export interface DodgeEcho {
	x: number;
	y: number;
	facing: Entity['facing'];
	type: Entity['type'];
	ageMs: number;
}

/** How long an echo lives before it fully fades (ms). */
export const DODGE_ECHO_LIFE_MS = FADE_MS;

/**
 * Fading dodge after-images (ADR 0038, pass 2, behind actors). Each echo stamps
 * the actor's idle silhouette with a translucent tint whose backdrop derives
 * from the composed scene beneath. Clipped by the compositor.
 */
export function drawDodgeEchoes(
	compositor: Compositor,
	echoes: readonly DodgeEcho[],
	cam: { x: number; y: number },
): void {
	for (const echo of echoes) {
		const fade = 1 - echo.ageMs / FADE_MS;
		if (fade <= 0) continue;
		const alpha = Math.round(PEAK_ALPHA * fade);
		if (alpha <= 0) continue;
		const col: RGBA = [ECHO_RGB[0], ECHO_RGB[1], ECHO_RGB[2], alpha];
		const sprite = spriteFor(echo.type);
		const rows = sprite.rows(echo.facing);
		const baseX = echo.x - Math.floor((sprite.w - BOX.w) / 2);
		const baseY = echo.y + BOX.h - sprite.h;
		for (let ry = 0; ry < rows.length; ry++) {
			const row = rows[ry];
			for (let rx = 0; rx < row.length; rx++) {
				if (row[rx] === ' ') continue;
				compositor.stampGlyph(
					Math.round(baseX + rx - cam.x),
					Math.round(baseY + ry - cam.y),
					row[rx],
					col,
				);
			}
		}
	}
}
