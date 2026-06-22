import { BOX } from './constants';
import { HATS, type Sprite, spriteFor, spriteForNpc } from './sprites';
import { isSolid } from './terrain';
import type { Entity, Facing, Npc, Terrain } from './types';
import type { Portal } from './world';

// A framework-agnostic cell sink, the subset of opentui's OptimizedBuffer the
// renderer needs. Generic over the colour type `C` so @mmo/shared stays
// opentui-free: the client and zone-tools each bind `C` to their own RGBA.
export interface CellBuffer<C> {
	readonly width: number;
	readonly height: number;
	clear(bg: C): void;
	setCell(x: number, y: number, ch: string, fg: C, bg: C): void;
	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: C,
		bg: C,
	): void;
}

// Colours the static Zone scene needs, resolved by the caller (opentui RGBA in
// practice). `palette` maps a Sprite's single-char colour keys to colours;
// unknown keys fall back to `paletteDefault`.
export interface RenderStyle<C> {
	bg: C;
	terrainFg: C;
	terrainBg: C;
	portal: C;
	transparent: C;
	hurt: C;
	nameplate: C;
	palette: Readonly<Record<string, C>>;
	paletteDefault: C;
	// Cosmetic catalogs resolved into the colour type (#35), indexed by an Avatar's
	// `Cosmetics` choices: `hues[hue]` recolours the body, `nameplates[nameplate]`
	// tints the handle. Hat art is glyph data (HATS), so it needs no colour here.
	cosmetics: {
		hues: readonly C[];
		nameplates: readonly C[];
	};
}

// The static, simulation-free layers of a Zone: terrain, portals, NPCs, and a
// pre-z-ordered set of entities (Monsters + co-present Avatars). Interaction
// prompts, the local Avatar, telegraphs, speech bubbles and projectiles are the
// caller's dynamic overlays, drawn on top after this.
export interface ZoneScene {
	terrain: Terrain;
	portals: readonly Portal[];
	npcs: readonly Npc[];
	entities: readonly Entity[];
}

// Blit a Sprite's lit glyphs into the buffer with palette colours, clipping to
// the viewport. A `hurt` flash overrides every glyph with the hurt colour. An
// optional `recolor` overrides specific colour keys for this blit only — the seam
// the cosmetic body hue uses to repaint the Avatar's `p` cells per Avatar (#35),
// leaving the shared palette untouched.
function blitSprite<C>(
	buf: CellBuffer<C>,
	sprite: Sprite,
	sx: number,
	sy: number,
	facing: Facing,
	hurt: boolean,
	style: RenderStyle<C>,
	recolor?: Readonly<Record<string, C>>,
): void {
	const sw = buf.width;
	const sh = buf.height;
	const glyphs = sprite.rows(facing);
	const keys = sprite.colorKeys(facing);
	for (let ry = 0; ry < sprite.h; ry++) {
		const py = sy + ry;
		if (py < 0 || py >= sh) continue;
		const row = glyphs[ry];
		const krow = keys[ry];
		for (let rx = 0; rx < sprite.w; rx++) {
			const ch = row[rx];
			if (ch === ' ') continue;
			const px = sx + rx;
			if (px < 0 || px >= sw) continue;
			const key = krow[rx];
			const fg = hurt
				? style.hurt
				: (recolor?.[key] ?? style.palette[key] ?? style.paletteDefault);
			buf.setCellWithAlphaBlending(px, py, ch, fg, style.transparent);
		}
	}
}

function drawText<C>(
	buf: CellBuffer<C>,
	x: number,
	y: number,
	text: string,
	fg: C,
	transparent: C,
): void {
	if (y < 0 || y >= buf.height) return;
	for (let i = 0; i < text.length; i++) {
		const px = x + i;
		if (px < 0 || px >= buf.width) continue;
		buf.setCellWithAlphaBlending(px, y, text[i], fg, transparent);
	}
}

// The hat Sprite an Avatar wears this frame, or null (bareheaded, a Monster, or a
// stray index). Centralised so the Sprite blit and the nameplate offset agree on
// the same hat height (#35).
function hatFor(e: Entity): Sprite | null {
	return e.cosmetics ? (HATS[e.cosmetics.hat]?.sprite ?? null) : null;
}

// The per-Avatar body recolour for its chosen hue, or undefined (no cosmetics /
// stray index). Repaints the Sprite's `p` body cells; a stray hue index falls back
// to the unrecoloured palette (#35).
function recolorFor<C>(
	e: Entity,
	style: RenderStyle<C>,
): Readonly<Record<string, C>> | undefined {
	const hue = e.cosmetics && style.cosmetics.hues[e.cosmetics.hue];
	return hue !== undefined ? { p: hue } : undefined;
}

// An Entity Sprite, centred horizontally over the ~1×2 collision box with its
// feet aligned to the box bottom (ADR 0003). Entities round relative to the
// FLOAT `cam` (not the whole-cell terrain camera) so a camera-pinned Avatar sits
// on a stable cell instead of bouncing ±1 from double-rounding. An Avatar's
// cosmetic hue recolours the body and its cosmetic hat is overlaid on the head (#35).
export function drawEntitySprite<C>(
	buf: CellBuffer<C>,
	e: Entity,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
): void {
	const sprite = spriteFor(e.type);
	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	const sy = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const hurt = e.hurtT > 0.3;
	blitSprite(buf, sprite, sx, sy, e.facing, hurt, style, recolorFor(e, style));

	// The cosmetic hat sits directly above the head (its bottom row on the row above
	// the Sprite top), centred over the Sprite, mirrored with the Avatar's facing.
	const hat = hatFor(e);
	if (hat) {
		const hx = sx + Math.round((sprite.w - hat.w) / 2);
		const hy = sy - hat.h;
		blitSprite(buf, hat, hx, hy, e.facing, hurt, style);
	}
}

// A Player Avatar's handle, centred over its box one row above the Sprite top (or
// above the hat, if any). Tinted to the Avatar's cosmetic nameplate colour, falling
// back to the default plate colour (#35). Only entities carrying a `name`
// (co-present Players) get a plate.
function drawNameplate<C>(
	buf: CellBuffer<C>,
	e: Entity,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
): void {
	if (!e.name) return;
	const sprite = spriteFor(e.type);
	const top = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const cx = e.x + BOX.w / 2 - cam.x;
	const x = Math.round(cx - e.name.length / 2);
	// Clear the hat so the plate never overlaps it.
	const hatH = hatFor(e)?.h ?? 0;
	const color =
		(e.cosmetics && style.cosmetics.nameplates[e.cosmetics.nameplate]) ??
		style.nameplate;
	drawText(buf, x, top - 1 - hatH, e.name, color, style.transparent);
}

export function renderZoneScene<C>(
	buf: CellBuffer<C>,
	scene: ZoneScene,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
): void {
	const sw = buf.width;
	const sh = buf.height;
	const { terrain } = scene;
	const ww = terrain.w;
	const wh = terrain.h;

	// Terrain samples the integer grid, so it scrolls on a whole-cell camera;
	// entities round relative to the float `cam` instead (see camera.ts), so a
	// camera-pinned Avatar renders at a stable cell rather than bouncing ±1.
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);

	buf.clear(style.bg);

	for (let sy = 0; sy < sh; sy++) {
		const wy = sy + camY;
		for (let sx = 0; sx < sw; sx++) {
			const wx = sx + camX;
			if (isSolid(terrain, wx, wy) && wx >= 0 && wx < ww && wy >= 0 && wy < wh)
				buf.setCell(sx, sy, '█', style.terrainFg, style.terrainBg);
		}
	}

	// Drawn before the Sprites so an Avatar stands in front of the door.
	for (const pr of scene.portals) {
		for (let yy = 0; yy < pr.h; yy++) {
			for (let xx = 0; xx < pr.w; xx++) {
				const px = pr.x + xx - camX;
				const py = pr.y + yy - camY;
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(
						px,
						py,
						'▒',
						style.portal,
						style.transparent,
					);
			}
		}
	}

	// NPCs are static content (not simulated), keyed off their own `kind`. Drawn
	// before the entity Sprites so the player stands in front.
	for (const n of scene.npcs) {
		const sprite = spriteForNpc(n.kind);
		const sx = Math.round(n.x + Math.floor((n.w - sprite.w) / 2)) - camX;
		const sy = Math.round(n.y + n.h - sprite.h) - camY;
		blitSprite(buf, sprite, sx, sy, 1, false, style);
	}

	// Co-present Avatars and Monsters share one z-ordered set (by y-position) so
	// they occlude each other naturally (ADR 0003). Sorted here so every caller
	// gets correct depth without duplicating the rule.
	const sprites = [...scene.entities].sort((a, b) => a.y - b.y);
	for (const e of sprites) {
		drawEntitySprite(buf, e, cam, style);
		drawNameplate(buf, e, cam, style);
	}
}
