import {
	BOX,
	darken,
	type Entity,
	NAMEPLATE_COLORS,
	SCENE_COLORS,
} from '@mmo/core/entities';
import type { Compositor, RGBA } from '../compositor';
import {
	actorFootDepth,
	displayColumns,
	segmentGraphemes,
	textColumns,
} from '../sprites';

/**
 * Stamp text one grapheme cluster per cell, advancing by displayed columns. A
 * two-column grapheme is one atomic overlay across its two cells; zero-width
 * clusters (already folded into their base) contribute nothing. Returns the
 * columns consumed.
 */
function stampText(
	compositor: Compositor,
	x: number,
	y: number,
	text: string,
	fg: RGBA,
	bg?: RGBA,
): number {
	let col = 0;
	for (const g of segmentGraphemes(text)) {
		const cols = displayColumns(g);
		if (cols === 0) continue;
		if (cols === 2) compositor.stampWideGlyph(x + col, y, g, fg, bg);
		else compositor.stampGlyph(x + col, y, g, fg, bg);
		col += cols;
	}
	return col;
}

const NAMEPLATE_INK: RGBA = SCENE_COLORS.nameplate;
const NAMEPLATE_BG: RGBA = darken(SCENE_COLORS.nameplate);
const NAMEPLATE_INKS: readonly RGBA[] = NAMEPLATE_COLORS;
const NAMEPLATE_BGS: readonly RGBA[] = NAMEPLATE_COLORS.map(darken);

/**
 * Cell-aligned world text (ADR 0038, pass 6). Each grapheme cluster stamps as one
 * atomic cell with no authored background, so the compositor derives its backdrop
 * from the composed scene beneath — the label reveals the real pixels it sits
 * over, never a guessed colour. Text advances by displayed columns; a two-column
 * grapheme is one atomic overlay across two cells. Clipped by the compositor.
 */
export function drawLabel(
	compositor: Compositor,
	x: number,
	y: number,
	text: string,
	fg: RGBA,
): void {
	stampText(compositor, x, y, text, fg);
}

/**
 * Identity nameplates for the given actors (ADR 0038, pass 6). Each name draws on
 * an opaque plate — ink and darkened background from the actor's chosen nameplate
 * cosmetic — planted at the actor's foot depth so it tracks exactly where
 * {@link actorFootDepth} places the body. The plate is a deliberate solid chip,
 * so its authored background stays opaque rather than revealing the scene.
 */
export function drawNameplates(
	compositor: Compositor,
	entities: readonly Entity[],
	cam: { x: number; y: number },
): void {
	for (const e of entities) {
		if (!e.name) continue;
		const idx = e.cosmetics?.nameplate;
		const ink =
			(idx !== undefined ? NAMEPLATE_INKS[idx] : undefined) ?? NAMEPLATE_INK;
		const bg =
			(idx !== undefined ? NAMEPLATE_BGS[idx] : undefined) ?? NAMEPLATE_BG;
		const cx = e.x + BOX.w / 2 - cam.x;
		const left = Math.round(cx - textColumns(e.name) / 2);
		const py = Math.round(actorFootDepth(e) - cam.y);
		stampText(compositor, left, py, e.name, ink, bg);
	}
}
