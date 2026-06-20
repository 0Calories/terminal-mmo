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
import {
	aabbOverlap,
	activeZone,
	BOX,
	COMBAT,
	entityBox,
	isSolid,
	meleeHitbox,
	skillForSlot,
	skillHitbox,
} from '@mmo/shared';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
} from '@opentui/core';
import { type CameraState, initCameraState, stepCamera } from './camera';
import type { Sprite } from './sprites';
import { PALETTE, spriteFor, spriteForNpc } from './sprites';
import { COLORS as C } from './theme';

// Blit a Sprite's glyph + colour grid into the buffer at a screen anchor (top-
// left sx, sy), honouring transparency and per-cell palette keys. `hurt` tints
// every lit cell with the hurt flash. The anchor + facing are the caller's to
// compute, so this serves both simulated entities and decorative NPCs.
function blitSprite(
	buf: OptimizedBuffer,
	sprite: Sprite,
	sx: number,
	sy: number,
	facing: Entity['facing'],
	sw: number,
	sh: number,
	hurt: boolean,
) {
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
			const fg = hurt ? C.hurt : (PALETTE[krow[rx]] ?? C.hud);
			buf.setCellWithAlphaBlending(px, py, ch, fg, C.transparent);
		}
	}
}

function drawSprite(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	const sprite = spriteFor(e.type);
	// Anchor per-sprite: centred horizontally, feet aligned to the box bottom.
	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	const sy = Math.round(e.y + BOX.h - sprite.h - cam.y);
	// state-driven tint, overrides the art's colour
	blitSprite(buf, sprite, sx, sy, e.facing, sw, sh, e.hurtT > 0.3);
}

function drawText(
	buf: OptimizedBuffer,
	x: number,
	y: number,
	text: string,
	fg: typeof C.hud,
	sw: number,
	sh: number,
) {
	if (y < 0 || y >= sh) return;
	for (let i = 0; i < text.length; i++) {
		const px = x + i;
		if (px < 0 || px >= sw) continue;
		buf.setCellWithAlphaBlending(px, y, text[i], fg, C.transparent);
	}
}

function drawPlayfield(
	buf: OptimizedBuffer,
	game: GameState,
	cam: { x: number; y: number },
) {
	const { player } = game;
	const zone = activeZone(game.world, player.zoneId);
	const sw = buf.width;
	const sh = buf.height;
	const p = player.avatar;
	const ww = zone.terrain.w;
	const wh = zone.terrain.h;

	// Terrain + world-fixed geometry (portals) sample the integer grid, so they
	// scroll on a whole-cell camera. Entities below round relative to the FLOAT
	// `cam` instead, so a camera-pinned Avatar renders at a stable cell rather
	// than bouncing ±1 from double-rounding (see camera.ts).
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);

	buf.clear(C.bg);

	// terrain (visible cells only)
	for (let sy = 0; sy < sh; sy++) {
		const wy = sy + camY;
		for (let sx = 0; sx < sw; sx++) {
			const wx = sx + camX;
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

	// portals: a shimmering gateway glyph over their footprint, drawn behind the
	// Sprites so the Avatar stands in front of the door (story 14). An enter
	// prompt floats above the one the Avatar is currently standing on.
	const onPortal = zone.portals.find((pr) => aabbOverlap(entityBox(p), pr));
	for (const pr of zone.portals) {
		for (let yy = 0; yy < pr.h; yy++) {
			for (let xx = 0; xx < pr.w; xx++) {
				const px = pr.x + xx - camX;
				const py = pr.y + yy - camY;
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(px, py, '▒', C.portal, C.transparent);
			}
		}
	}
	if (onPortal) {
		const dest = game.world.zones[onPortal.target]?.type ?? 'zone';
		const label = `↵ e  enter the ${dest.charAt(0).toUpperCase()}${dest.slice(1)}`;
		drawText(
			buf,
			Math.round(onPortal.x) - camX,
			Math.round(onPortal.y) - camY - 1,
			label,
			C.portal,
			sw,
			sh,
		);
	}

	// NPCs (Town vendor, story 29): a multi-row Avatar Sprite over the NPC's small
	// logical footprint (ADR 0003), drawn behind the entity Sprites like portals so
	// the player stands in front. World-fixed, so it scrolls on the whole-cell grid
	// (camX/camY). A talk prompt floats above the head of the overlapped NPC.
	const npcs = zone.npcs ?? [];
	const onNpc = npcs.find((n) => aabbOverlap(entityBox(p), n));
	for (const n of npcs) {
		const sprite = spriteForNpc(n.kind);
		const sx = Math.round(n.x + Math.floor((n.w - sprite.w) / 2)) - camX;
		const sy = Math.round(n.y + n.h - sprite.h) - camY;
		blitSprite(buf, sprite, sx, sy, 1, sw, sh, false);
		if (n === onNpc)
			drawText(buf, sx, sy - 1, `↵ e  talk to ${n.name}`, C.vendor, sw, sh);
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

	// Skill telegraph: flash the (wider) Skill arc just after it fires. Detected
	// from the freshly-set cooldown, mirroring the melee flash window.
	for (let slot = 1; ; slot++) {
		const skill = skillForSlot(player.class ?? 'warrior', slot);
		if (!skill) break;
		const cd = player.skillCooldowns?.[skill.id] ?? 0;
		if (cd <= skill.cooldown - 0.15) continue;
		const hb = skillHitbox(p, skill);
		for (let yy = 0; yy < hb.h; yy++) {
			for (let xx = 0; xx < hb.w; xx++) {
				const px = Math.round(hb.x + xx - cam.x);
				const py = Math.round(hb.y + yy - cam.y);
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(px, py, '✦', C.melee, C.transparent);
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

	// Dead-band camera state, carried across frames (view-only — see camera.ts).
	private camState: CameraState = initCameraState();

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		super(ctx, { width: '100%', height: '100%', live: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (!this.game) return;
		const zone = activeZone(this.game.world, this.game.player.zoneId);
		const a = this.game.player.avatar;
		this.camState = stepCamera(
			this.camState,
			this.game.player.zoneId,
			a.x,
			a.y,
			{
				sw: buffer.width,
				sh: buffer.height,
				ww: zone.terrain.w,
				wh: zone.terrain.h,
			},
		);
		if (this.camState.cam) drawPlayfield(buffer, this.game, this.camState.cam);
	}
}
