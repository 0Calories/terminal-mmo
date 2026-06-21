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
import { layoutBubble } from './bubble';
import { type CameraState, initCameraState, stepCamera } from './camera';
import type { Sprite } from './sprites';
import { PALETTE, spriteFor, spriteForNpc } from './sprites';
import { COLORS as C } from './theme';

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
	// Centred horizontally, feet aligned to the box bottom.
	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	const sy = Math.round(e.y + BOX.h - sprite.h - cam.y);
	blitSprite(buf, sprite, sx, sy, e.facing, sw, sh, e.hurtT > 0.3);
}

// A Player Avatar's handle, centred over its collision box one row above the
// Sprite top. Only `others` carry a name (Monsters and the own Avatar don't), so
// this draws a nameplate for co-present Players only. Plain colour for now;
// nameplate cosmetics arrive with M3 identity.
function drawNameplate(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!e.name) return;
	const sprite = spriteFor(e.type);
	const top = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const cx = e.x + BOX.w / 2 - cam.x;
	const x = Math.round(cx - e.name.length / 2);
	drawText(buf, x, top - 1, e.name, C.dim, sw, sh);
}

// An over-head Speech bubble for the sender's latest Chat line (#59, ADR 0007):
// a bordered, opaque box with a downward tail, anchored above the nameplate and
// re-projected through the camera each frame so it tracks the moving Avatar. The
// box is x-clamped to the viewport so a full-length message can't clip off-screen.
function drawSpeechBubble(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!e.bubble) return;
	const sprite = spriteFor(e.type);
	const top = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const lines = layoutBubble(e.bubble);
	const innerW = Math.max(...lines.map((l) => l.length));
	const boxW = innerW + 2;
	const boxH = lines.length + 2;

	const cx = e.x + BOX.w / 2 - cam.x;
	// Tail tip sits one row above the nameplate (which is at top - 1); the box bottom
	// border is just above the tail.
	const tailY = top - 2;
	const tailX = Math.round(cx);
	const topY = tailY - boxH;
	let left = Math.round(cx - boxW / 2);
	left = Math.max(0, Math.min(left, sw - boxW)); // keep the whole box on screen

	for (let ry = 0; ry < boxH; ry++) {
		const py = topY + ry;
		if (py < 0 || py >= sh) continue;
		const lastRow = ry === boxH - 1;
		for (let rx = 0; rx < boxW; rx++) {
			const px = left + rx;
			if (px < 0 || px >= sw) continue;
			const lastCol = rx === boxW - 1;
			let ch = ' ';
			let fg = C.bubbleFg;
			if (ry === 0 || lastRow || rx === 0 || lastCol) {
				fg = C.bubbleBorder;
				if (ry === 0) ch = rx === 0 ? '╭' : lastCol ? '╮' : '─';
				else if (lastRow) ch = rx === 0 ? '╰' : lastCol ? '╯' : '─';
				else ch = '│';
			} else {
				ch = lines[ry - 1]?.[rx - 1] ?? ' ';
			}
			buf.setCell(px, py, ch, fg, C.bubbleBg);
		}
	}
	if (tailY >= 0 && tailY < sh && tailX >= 0 && tailX < sw)
		buf.setCell(tailX, tailY, '▼', C.bubbleBorder, C.bubbleBg);
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

	// Terrain + portals sample the integer grid, so they scroll on a whole-cell
	// camera. Entities round relative to the FLOAT `cam` instead, so a
	// camera-pinned Avatar renders at a stable cell rather than bouncing ±1 from
	// double-rounding (see camera.ts).
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);

	buf.clear(C.bg);

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

	// Drawn before the Sprites so the Avatar stands in front of the door.
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

	// Drawn before the entity Sprites so the player stands in front.
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

	// Co-present Avatars and Monsters share one z-ordered set (by y-position) so
	// they occlude each other naturally; the local Avatar is still drawn last,
	// on top of everyone (ADR 0003).
	const others = game.others ?? [];
	const sprites = [...zone.monsters, ...others].sort((a, b) => a.y - b.y);
	for (const e of sprites) {
		drawSprite(buf, e, cam, sw, sh);
		drawNameplate(buf, e, cam, sw, sh);
	}

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

	// Detected from the freshly-set cooldown, mirroring the melee flash window.
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

	// Final pass after all Sprites + nameplates: over-head Speech bubbles for every
	// chatter on screen, the local Avatar included (one uniform rule, ADR 0007). An
	// absent sender simply has no entity here, so its bubble isn't drawn.
	for (const e of others) drawSpeechBubble(buf, e, cam, sw, sh);
	drawSpeechBubble(buf, p, cam, sw, sh);

	// Drawn last so nothing occludes an incoming shot.
	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		buf.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}
}

export class PlayfieldRenderable extends Renderable {
	game: GameState | null = null;

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
