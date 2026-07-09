import type { AttackPhase, Entity, GameState } from '@mmo/core';
import {
	ACTION_FLAG,
	aabbOverlap,
	activeZone,
	entityBox,
	guardPoseCell,
	guardPoseGlyph,
	guardRaised,
	itemLabel,
	skillForSlot,
	skillHitbox,
	swingPhase,
	swingPose,
	swingPoseCell,
	swingProgress,
} from '@mmo/core';
import {
	buildSceneStyle,
	drawEntitySprite,
	drawNameplates,
	type RenderStyle,
	renderZoneScene,
	spriteForNpc,
} from '@mmo/render';
import { type OptimizedBuffer, RGBA } from '@opentui/core';
import type { VisualEffects } from '../effects';
import { COLORS as C, RARITY_RGBA } from '../theme';
import { drawSpeechBubble } from '../ui/speech-bubble';

const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

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

function swingRenderState(
	e: Entity,
): { phase: AttackPhase; progress: number } | null {
	if (e.action && e.action.move !== 'idle')
		return { phase: e.action.phase, progress: e.action.progress };
	const phase = swingPhase(e.attackT);
	return phase ? { phase, progress: swingProgress(e.attackT) } : null;
}

function drawSwing(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (e.weapon !== undefined) return;
	const st = swingRenderState(e);
	if (!st) return;
	const move = e.action && e.action.move !== 'idle' ? e.action.move : 'basic';
	const pose = swingPose(move, st.phase, e.facing);
	if (!pose) return;
	const cell = swingPoseCell(e, st.phase);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			pose.glyph,
			C.telegraph,
			C.transparent,
		);
}

function isGuarding(e: Entity): boolean {
	if (e.action) return (e.action.flags & ACTION_FLAG.guarding) !== 0;
	return guardRaised(e.guardT ?? 0);
}

function drawGuard(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!isGuarding(e)) return;
	const cell = guardPoseCell(e);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			guardPoseGlyph(),
			C.guard,
			C.transparent,
		);
}

export function drawPlayfield(
	buf: OptimizedBuffer,
	game: GameState,
	cam: { x: number; y: number },
	visuals: VisualEffects,
) {
	const { player } = game;
	const zone = activeZone(game.world, player.zoneId);
	const sw = buf.width;
	const sh = buf.height;
	const p = player.avatar;
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	const others = game.others ?? [];
	const npcs = zone.npcs ?? [];

	renderZoneScene(
		buf,
		{
			terrain: zone.terrain,
			portals: zone.portals,
			npcs,
			entities: [...zone.monsters, ...others],
		},
		cam,
		STYLE,
	);

	// Resting/fading blood behind the Sprites (airborne blood is drawn in front, below).
	visuals.draw(buf, cam, 'settled');

	const onPortal = zone.portals.find((pr) => aabbOverlap(entityBox(p), pr));
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
	const onNpc = npcs.find((n) => aabbOverlap(entityBox(p), n));
	if (onNpc) {
		const sprite = spriteForNpc(onNpc.kind);
		const sx =
			Math.round(onNpc.x + Math.floor((onNpc.w - sprite.w) / 2)) - camX;
		const sy = Math.round(onNpc.y + onNpc.h - sprite.h) - camY;
		if (onNpc.kind === 'signpost' && onNpc.lines && onNpc.lines.length > 0) {
			const lines = onNpc.lines;
			lines.forEach((line, i) => {
				drawText(buf, sx, sy - lines.length + i, line, C.signpost, sw, sh);
			});
		} else {
			drawText(buf, sx, sy - 1, `↵ e  talk to ${onNpc.name}`, C.vendor, sw, sh);
		}
	}

	for (const d of zone.drops ?? []) {
		const col = RARITY_RGBA[d.item.rarity];
		const gx = Math.round(d.x + d.w / 2) - camX;
		const gy = Math.round(d.y + d.h - 1) - camY;
		if (gx >= 0 && gx < sw && gy >= 0 && gy < sh)
			buf.setCellWithAlphaBlending(gx, gy, '◆', col, C.transparent);
		const label = itemLabel(d.item);
		drawText(
			buf,
			gx - Math.floor(label.length / 2),
			gy - 1,
			label,
			col,
			sw,
			sh,
		);
	}

	for (const e of others) {
		drawSwing(buf, e, cam, sw, sh);
		drawGuard(buf, e, cam, sw, sh);
	}

	for (const m of zone.monsters) drawSwing(buf, m, cam, sw, sh);

	// Flash only just after the skill fires, mirroring the melee flash window.
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
					buf.setCellWithAlphaBlending(px, py, '✦', C.telegraph, C.transparent);
			}
		}
	}

	visuals.draw(buf, cam, 'echoes');

	// The local Avatar drawn last, on top of everyone.
	drawEntitySprite(buf, p, cam, STYLE, zone.terrain);
	drawSwing(buf, p, cam, sw, sh);
	drawGuard(buf, p, cam, sw, sh);

	// Airborne blood in front of the Sprites, still below the over-head bubbles so chat stays legible.
	visuals.draw(buf, cam, 'airborne');

	drawNameplates(buf, others, cam, zone.terrain, STYLE);

	for (const e of others) drawSpeechBubble(buf, e, cam, zone.terrain, sw, sh);
	drawSpeechBubble(buf, p, cam, zone.terrain, sw, sh);

	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		buf.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}
}
