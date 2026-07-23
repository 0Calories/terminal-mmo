import {
	ACTION_FLAG,
	guardOverlayCell,
	guardOverlayGlyph,
	guardRaised,
	type PlayerClass,
	skillForSlot,
	skillHitbox,
	swingOverlay,
	swingOverlayCell,
	swingPhase,
	swingProgress,
} from '@mmo/core/combat';
import type { AttackPhase, Entity, Projectile } from '@mmo/core/entities';
import type { Compositor, RGBA } from '../compositor';

/**
 * Whether an entity is mid-swing this frame and, if so, which phase and how far
 * through it. Prefers an authored action; otherwise reads the swing timer.
 */
function swingRenderState(
	e: Entity,
): { phase: AttackPhase; progress: number } | null {
	if (e.action && e.action.move !== 'idle')
		return { phase: e.action.phase, progress: e.action.progress };
	const phase = swingPhase(e.attackT);
	return phase ? { phase, progress: swingProgress(e.attackT) } : null;
}

/**
 * Melee swing overlay (ADR 0038, pass 5). The swing glyph stamps atop the
 * composed actors and Terrain with no authored background, so the compositor
 * derives its backdrop from the scene beneath — the swing reveals the real
 * pixels it arcs over, never a guessed colour. Clipped by the compositor.
 */
export function drawSwing(
	compositor: Compositor,
	e: Entity,
	cam: { x: number; y: number },
	color: RGBA,
): void {
	if (e.weapon !== undefined) return;
	const st = swingRenderState(e);
	if (!st) return;
	const move = e.action && e.action.move !== 'idle' ? e.action.move : 'basic';
	const overlay = swingOverlay(move, st.phase, e.facing);
	if (!overlay) return;
	const cell = swingOverlayCell(e, st.phase);
	compositor.stampGlyph(
		Math.round(cell.x - cam.x),
		Math.round(cell.y - cam.y),
		overlay.glyph,
		color,
	);
}

function isGuarding(e: Entity): boolean {
	if (e.action) return (e.action.flags & ACTION_FLAG.guarding) !== 0;
	return guardRaised(e.guardT ?? 0);
}

/**
 * Raised-guard overlay (ADR 0038, pass 5). Draws over composed actors and
 * derives its backdrop from the scene beneath. Clipped by the compositor.
 */
export function drawGuard(
	compositor: Compositor,
	e: Entity,
	cam: { x: number; y: number },
	color: RGBA,
): void {
	if (!isGuarding(e)) return;
	const cell = guardOverlayCell(e);
	compositor.stampGlyph(
		Math.round(cell.x - cam.x),
		Math.round(cell.y - cam.y),
		guardOverlayGlyph(),
		color,
	);
}

/**
 * Skill-hitbox telegraphs for the local Avatar (ADR 0038, pass 5). Each unlocked
 * slot whose cooldown is freshly spent stamps `✦` across its hitbox, composing
 * over actors and revealing the scene beneath. Combat geometry (which slots
 * exist, their hitboxes) stays in `@mmo/core/combat`; only the glyph placement
 * lives here. Clipped by the compositor.
 */
export function drawSkillTelegraphs(
	compositor: Compositor,
	avatar: Entity,
	playerClass: PlayerClass,
	cooldowns: Readonly<Record<string, number>>,
	cam: { x: number; y: number },
	color: RGBA,
): void {
	for (let slot = 1; ; slot++) {
		const skill = skillForSlot(playerClass, slot);
		if (!skill) break;
		const cd = cooldowns[skill.id] ?? 0;
		if (cd <= skill.cooldown - 0.15) continue;
		const hb = skillHitbox(avatar, skill);
		for (let yy = 0; yy < hb.h; yy++)
			for (let xx = 0; xx < hb.w; xx++)
				compositor.stampGlyph(
					Math.round(hb.x + xx - cam.x),
					Math.round(hb.y + yy - cam.y),
					'✦',
					color,
				);
	}
}

/**
 * In-flight Projectiles (ADR 0038, pass 5). A directional glyph derived from the
 * horizontal velocity, composing over actors and revealing the scene beneath —
 * no longer bypassing the pass order to draw last (ADR 0023). Clipped by the
 * compositor.
 */
export function drawProjectiles(
	compositor: Compositor,
	projectiles: readonly Projectile[],
	cam: { x: number; y: number },
	color: RGBA,
): void {
	for (const pr of projectiles) {
		const char = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		compositor.stampGlyph(
			Math.round(pr.x - cam.x),
			Math.round(pr.y - cam.y),
			char,
			color,
		);
	}
}
