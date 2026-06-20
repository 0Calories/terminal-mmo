import type { Entity, GameState } from '@mmo/shared';
import { activeZone, BOX, COMBAT, isSolid, meleeHitbox } from '@mmo/shared';
import type { OptimizedBuffer } from '@opentui/core';
import { RGBA } from '@opentui/core';
import { PALETTE, spriteFor } from './sprites';

const C = {
	bg: RGBA.fromInts(16, 18, 26, 255),
	terrainFg: RGBA.fromInts(70, 82, 104, 255),
	terrainBg: RGBA.fromInts(34, 40, 54, 255),
	transparent: RGBA.fromInts(0, 0, 0, 0),
	hurt: RGBA.fromInts(255, 240, 120, 255),
	melee: RGBA.fromInts(255, 245, 200, 255),
	hud: RGBA.fromInts(232, 232, 238, 255),
	hudBg: RGBA.fromInts(8, 9, 13, 255),
	hp: RGBA.fromInts(90, 220, 120, 255),
	dim: RGBA.fromInts(150, 156, 168, 255),
};

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
		if (py < 1 || py >= sh) continue; // top row reserved for HUD
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

export function draw(buf: OptimizedBuffer, game: GameState, fps: number) {
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
	for (let sy = 1; sy < sh; sy++) {
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
				if (px >= 0 && px < sw && py >= 1 && py < sh)
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

	// HUD
	for (let x = 0; x < sw; x++) buf.setCell(x, 0, ' ', C.hud, C.hudBg);
	const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
	const left = ` L${player.progress.level}  HP ${Math.max(0, Math.round(p.hp))}/${p.maxHp} (${hpPct}%)  XP ${player.progress.xp}  Gold ${player.progress.gold}  Items ${player.inventory.length} `;
	buf.drawText(left, 0, 0, C.hud, C.hudBg);
	const right = `FPS ${fps}  monsters ${zone.monsters.length} `;
	buf.drawText(right, Math.max(0, sw - right.length), 0, C.dim, C.hudBg);

	// recent log, bottom-left
	const lines = player.log.slice(-3);
	for (let i = 0; i < lines.length; i++) {
		const ly = sh - lines.length + i;
		if (ly > 0) buf.drawText(lines[i].slice(0, sw), 1, ly, C.dim, C.bg);
	}

	// controls hint
	const hint = 'move ←/→ a/d  jump ␣/↑  attack j/x  quit q';
	buf.drawText(
		hint.slice(0, sw),
		1,
		sh - lines.length - 1 > 0 ? sh - lines.length - 1 : sh - 1,
		C.dim,
		C.bg,
	);
}
