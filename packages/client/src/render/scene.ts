import { aabbOverlap, entityBox } from '@mmo/core/combat';
import { itemLabel } from '@mmo/core/items';
import { activeZone, type GameState } from '@mmo/core/protocol';
import {
	buildSceneStyle,
	type CellBuffer,
	drawNameplates,
	type RenderStyle,
	spriteForNpc,
} from '@mmo/render';
import type { Compositor, RGBA as RGBA8 } from '@mmo/render/compositor';
import {
	drawDrops,
	drawGuard,
	drawPortals,
	drawProjectiles,
	drawSkillTelegraphs,
	drawSwing,
	drawTerrain,
	sortActorsByDepth,
} from '@mmo/render/scene';
import {
	actorFootDepth,
	npcFootDepth,
	paintActor,
	paintNpc,
} from '@mmo/render/sprites';
import { type OptimizedBuffer, RGBA } from '@opentui/core';
import type { ParticleEngine } from '../particles';
import { COLORS as C, RARITY_RGBA } from '../theme';
import { drawSpeechBubble } from '../ui/speech-bubble';
import { CompositorSink, encodeToBuffer } from './compositor-sink';
import type { DodgeTracker } from './dodge-echo';

const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// Combat glyph colours as the compositor's 8-bit model. The client theme stays
// the single source of truth (the HUD reads the same colours); pass 5 threads
// these into the native scene draws instead of guessing a background.
const COMBAT_TELEGRAPH: RGBA8 = C.telegraph.toInts();
const COMBAT_GUARD: RGBA8 = C.guard.toInts();
const COMBAT_PROJECTILE: RGBA8 = C.projectile.toInts();

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

/**
 * Compose one live playfield frame into the shared sub-cell {@link Compositor}
 * in the accepted back-to-front pass order (ADR 0038), then encode to OpenTUI
 * exactly once. Terrain, world-floor, and combat visuals compose natively via
 * the `@mmo/render/scene` module and actors via {@link paintActor}; the
 * remaining producers (settled and airborne particles, labels, bubbles) draw
 * through the {@link CompositorSink} bridge, so nothing but the final encode
 * reaches OpenTUI.
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

	// Pass 3: NPCs, Monsters, and remote Avatars as one crowd sorted by logical
	// foot depth (ADR 0038). Equal depth is deterministic — NPCs draw behind
	// monsters and remote avatars, then a stable id breaks ties — and each actor
	// draws atomically.
	const crowd = sortActorsByDepth([
		...npcs.map((n) => ({
			footY: npcFootDepth(n),
			category: 'npc' as const,
			id: n.id,
			paint: () => paintNpc(compositor, n, cam),
		})),
		...zone.monsters.map((m) => ({
			footY: actorFootDepth(m),
			category: 'monster' as const,
			id: m.id,
			paint: () => paintActor(compositor, m, cam),
		})),
		...others.map((o) => ({
			footY: actorFootDepth(o),
			category: 'avatar' as const,
			id: o.id,
			paint: () => paintActor(compositor, o, cam),
		})),
	]);
	for (const actor of crowd) actor.paint();

	// Pass 4: the local Avatar (native), kept at the top of the crowd.
	paintActor(compositor, p, cam);

	// Pass 5: combat — swings, guards, skill telegraphs, airborne particles, and
	// projectiles, composed natively so each glyph reveals the actors and Terrain
	// beneath it. The airborne-particle slot stays bridged (#447 owns it).
	for (const e of others) {
		drawSwing(compositor, e, cam, COMBAT_TELEGRAPH);
		drawGuard(compositor, e, cam, COMBAT_GUARD);
	}
	for (const m of zone.monsters)
		drawSwing(compositor, m, cam, COMBAT_TELEGRAPH);
	drawSwing(compositor, p, cam, COMBAT_TELEGRAPH);
	drawGuard(compositor, p, cam, COMBAT_GUARD);

	drawSkillTelegraphs(
		compositor,
		p,
		player.class ?? 'warrior',
		player.skillCooldowns ?? {},
		cam,
		COMBAT_TELEGRAPH,
	);

	fx.particles.draw(sink, cam, 'airborne');

	drawProjectiles(compositor, zone.projectiles, cam, COMBAT_PROJECTILE);

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
