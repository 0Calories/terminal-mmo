import {
	ACTION_FLAG,
	aabbOverlap,
	entityBox,
	guardOverlayCell,
	guardOverlayGlyph,
	guardRaised,
	skillForSlot,
	skillHitbox,
	swingOverlay,
	swingOverlayCell,
	swingPhase,
	swingProgress,
} from '@mmo/core/combat';
import type { AttackPhase, Entity } from '@mmo/core/entities';
import { itemLabel } from '@mmo/core/items';
import { activeZone, type GameState } from '@mmo/core/protocol';
import {
	buildSceneStyle,
	type CellBuffer,
	drawNameplates,
	type RenderStyle,
	spriteForNpc,
} from '@mmo/render';
import type { Compositor } from '@mmo/render/compositor';
import { drawDrops, drawPortals, drawTerrain } from '@mmo/render/scene';
import { paintActor, paintNpc } from '@mmo/render/sprites';
import { type OptimizedBuffer, RGBA } from '@opentui/core';
import type { ParticleEngine } from '../particles';
import { COLORS as C, RARITY_RGBA } from '../theme';
import { drawSpeechBubble } from '../ui/speech-bubble';
import { CompositorSink, encodeToBuffer } from './compositor-sink';
import type { DodgeTracker } from './dodge-echo';

const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

function drawText(
	buf: CellBuffer<RGBA>,
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
	buf: CellBuffer<RGBA>,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (e.weapon !== undefined) return;
	const st = swingRenderState(e);
	if (!st) return;
	const move = e.action && e.action.move !== 'idle' ? e.action.move : 'basic';
	const overlay = swingOverlay(move, st.phase, e.facing);
	if (!overlay) return;
	const cell = swingOverlayCell(e, st.phase);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			overlay.glyph,
			C.telegraph,
			C.transparent,
		);
}

function isGuarding(e: Entity): boolean {
	if (e.action) return (e.action.flags & ACTION_FLAG.guarding) !== 0;
	return guardRaised(e.guardT ?? 0);
}

function drawGuard(
	buf: CellBuffer<RGBA>,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!isGuarding(e)) return;
	const cell = guardOverlayCell(e);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			guardOverlayGlyph(),
			C.guard,
			C.transparent,
		);
}

/**
 * Compose one live playfield frame into the shared sub-cell {@link Compositor}
 * in the accepted back-to-front pass order (ADR 0038), then encode to OpenTUI
 * exactly once. Terrain and world-floor visuals compose natively via the
 * `@mmo/render/scene` module and actors via {@link paintActor}; the remaining
 * producers (settled particles, combat, labels, bubbles) draw through the
 * {@link CompositorSink} bridge, so nothing but the final encode reaches OpenTUI.
 */
export function drawPlayfield(
	buf: OptimizedBuffer,
	compositor: Compositor,
	game: GameState,
	cam: { x: number; y: number },
	fx: { particles: ParticleEngine; dodges: DodgeTracker },
) {
	const { player } = game;
	const zone = activeZone(game.world, player.zoneId);
	const sw = compositor.widthCells;
	const sh = compositor.heightCells;
	const p = player.avatar;
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	const others = game.others ?? [];
	const npcs = zone.npcs ?? [];
	const sink = new CompositorSink(compositor);
	compositor.clear();

	// Pass 1: Terrain, composed natively as the sub-cell backdrop.
	drawTerrain(compositor, zone.terrain, cam);

	// Pass 2: world-floor visuals below actors — portals, settled particles, drop
	// glyphs, dodge echoes. Settled particles stay bridged until #447; their slot
	// is preserved here.
	drawPortals(compositor, zone.portals, cam);
	fx.particles.draw(sink, cam, 'settled');
	drawDrops(compositor, zone.drops ?? [], cam);
	fx.dodges.draw(compositor, cam);

	// Pass 3: NPCs, Monsters, and remote Avatars (native). NPCs draw behind the
	// crowd; monsters and remote avatars are foot-depth sorted (full determinism
	// is #444).
	for (const n of npcs) paintNpc(compositor, n, cam);
	const crowd = [...zone.monsters, ...others].sort((a, b) => a.y - b.y);
	for (const e of crowd) paintActor(compositor, e, cam);

	// Pass 4: the local Avatar (native), kept at the top of the crowd.
	paintActor(compositor, p, cam);

	// Pass 5: combat — swings, guards, telegraphs, airborne particles, projectiles.
	for (const e of others) {
		drawSwing(sink, e, cam, sw, sh);
		drawGuard(sink, e, cam, sw, sh);
	}
	for (const m of zone.monsters) drawSwing(sink, m, cam, sw, sh);
	drawSwing(sink, p, cam, sw, sh);
	drawGuard(sink, p, cam, sw, sh);

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
					sink.setCellWithAlphaBlending(
						px,
						py,
						'✦',
						C.telegraph,
						C.transparent,
					);
			}
		}
	}

	fx.particles.draw(sink, cam, 'airborne');

	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		sink.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}

	// Pass 6: identity, drop, and interaction labels.
	const onPortal = zone.portals.find((pr) => aabbOverlap(entityBox(p), pr));
	if (onPortal) {
		const dest = game.world.zones[onPortal.target]?.type ?? 'zone';
		const label = `↵ e  enter the ${dest.charAt(0).toUpperCase()}${dest.slice(1)}`;
		drawText(
			sink,
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
		drawText(sink, sx, sy - 1, `↵ e  talk to ${onNpc.name}`, C.vendor, sw, sh);
	}
	for (const d of zone.drops ?? []) {
		const col = RARITY_RGBA[d.item.rarity];
		const gx = Math.round(d.x + d.w / 2) - camX;
		const gy = Math.round(d.y + d.h - 1) - camY;
		const label = itemLabel(d.item);
		drawText(
			sink,
			gx - Math.floor(label.length / 2),
			gy - 1,
			label,
			col,
			sw,
			sh,
		);
	}
	drawNameplates(sink, others, cam, zone.terrain, STYLE);

	// Pass 7: speech bubbles, frontmost.
	for (const e of others) drawSpeechBubble(sink, e, cam, zone.terrain, sw, sh);
	drawSpeechBubble(sink, p, cam, zone.terrain, sw, sh);

	// Encode the composed surface into OpenTUI exactly once.
	encodeToBuffer(compositor, buf);
}
