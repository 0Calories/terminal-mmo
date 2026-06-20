// PlayfieldRenderable (ADR 0005): the hot, per-frame playfield as a scene-graph
// node rather than a global post-process hook. `renderSelf` draws terrain +
// entity Sprites + combat telegraphs imperatively into the screen buffer every
// frame — the immediate-mode layer that a retained virtual-DOM would only slow
// down. `live` keeps the renderer drawing each frame so the sim animates
// continuously; `width/height: '100%'` fills the root so absolute buffer
// coordinates (the node sits at the origin) match the screen.
//
// Per ADR 0005 this layer draws ONLY the world; the HUD/log/hint chrome lives in
// hud.ts as layout-driven renderables that overlay this node (see Hud).
import type { Entity, GameState } from '@mmo/shared';
import { activeZone, BOX, COMBAT, isSolid, meleeHitbox } from '@mmo/shared';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
} from '@opentui/core';
import { PALETTE, spriteFor } from './sprites';
import { COLORS as C } from './theme';

function drawSprite(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	const sprite = spriteFor(e.type);
	const glyphs = sprite.rows(e.facing);
	const keys = sprite.colorKeys(e.facing);
	// Anchor per-sprite: centred horizontally, feet aligned to the box bottom.
	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	const sy = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const hurt = e.hurtT > 0.3; // state-driven tint, overrides the art's colour
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
			const fg = hurt ? C.hurt : (PALETTE[krow[rx]] ?? C.hud);
			buf.setCellWithAlphaBlending(px, py, ch, fg, C.transparent);
		}
	}
}

function drawPlayfield(buf: OptimizedBuffer, game: GameState) {
	const { player } = game;
	const zone = activeZone(game.world, player.zoneId);
	const sw = buf.width;
	const sh = buf.height;
	const p = player.avatar;
	const ww = zone.terrain.w;
	const wh = zone.terrain.h;
	const cam = {
		x: Math.max(
			0,
			Math.min(Math.round(p.x + BOX.w / 2 - sw / 2), Math.max(0, ww - sw)),
		),
		y: Math.max(
			0,
			Math.min(Math.round(p.y + BOX.h / 2 - sh / 2), Math.max(0, wh - sh)),
		),
	};

	buf.clear(C.bg);

	// terrain (visible cells only)
	for (let sy = 0; sy < sh; sy++) {
		const wy = sy + cam.y;
		for (let sx = 0; sx < sw; sx++) {
			const wx = sx + cam.x;
			if (
				isSolid(zone.terrain, wx, wy) &&
				wx >= 0 &&
				wx < ww &&
				wy >= 0 &&
				wy < wh
			)
				buf.setCell(sx, sy, '█', C.terrainFg, C.terrainBg);
		}
	}

	// entities, z-ordered by y; player drawn last (on top)
	const mons = [...zone.monsters].sort((a, b) => a.y - b.y);
	for (const m of mons) drawSprite(buf, m, cam, sw, sh);

	// melee telegraph: flash the arc right after a swing
	if (p.attackT > COMBAT.attackCooldown - 0.12) {
		const hb = meleeHitbox(p);
		for (let yy = 0; yy < hb.h; yy++) {
			for (let xx = 0; xx < hb.w; xx++) {
				const px = Math.round(hb.x + xx - cam.x);
				const py = Math.round(hb.y + yy - cam.y);
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(
						px,
						py,
						p.facing === 1 ? '/' : '\\',
						C.melee,
						C.transparent,
					);
			}
		}
	}

	drawSprite(buf, p, cam, sw, sh);

	// projectiles: high-contrast glyphs above all Sprites (ADR 0003), drawn last
	// so nothing occludes an incoming shot. Glyph leans into travel direction.
	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		buf.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}
}

export class PlayfieldRenderable extends Renderable {
	/** Latest simulation state to draw; the frame loop sets this each tick. */
	game: GameState | null = null;

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		super(ctx, { width: '100%', height: '100%', live: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (this.game) drawPlayfield(buffer, this.game);
	}
}
