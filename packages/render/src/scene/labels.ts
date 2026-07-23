import {
	BOX,
	darken,
	type Entity,
	NAMEPLATE_COLORS,
	SCENE_COLORS,
} from '@mmo/core/entities';
import type { Compositor, RGBA } from '../compositor';
import { actorFootDepth } from '../sprites';

const NAMEPLATE_INK: RGBA = SCENE_COLORS.nameplate;
const NAMEPLATE_BG: RGBA = darken(SCENE_COLORS.nameplate);
const NAMEPLATE_INKS: readonly RGBA[] = NAMEPLATE_COLORS;
const NAMEPLATE_BGS: readonly RGBA[] = NAMEPLATE_COLORS.map(darken);

/**
 * Cell-aligned world text (ADR 0038, pass 6). Each character stamps as one atomic
 * cell with no authored background, so the compositor derives its backdrop from
 * the composed scene beneath — the label reveals the real pixels it sits over,
 * never a guessed colour. Width-awareness is deferred (issue #452); one column
 * per character. Clipped by the compositor.
 */
export function drawLabel(
	compositor: Compositor,
	x: number,
	y: number,
	text: string,
	fg: RGBA,
): void {
	for (let i = 0; i < text.length; i++)
		compositor.stampGlyph(x + i, y, text[i], fg);
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
		const left = Math.round(cx - e.name.length / 2);
		const py = Math.round(actorFootDepth(e) - cam.y);
		for (let i = 0; i < e.name.length; i++)
			compositor.stampGlyph(left + i, py, e.name[i], ink, bg);
	}
}
