import { BOX, COMBAT } from './constants';
import { HUES, type RGBAQuad, SCENE_PALETTE } from './sceneStyle';
import { spriteFor } from './sprites';
import type { Box, Effect, Entity, Facing, Tint } from './types';

const BODY_PALETTE: Record<string, RGBAQuad> = SCENE_PALETTE;

// The body colour to tint an entity's death gore with (#139): an Avatar uses its
// chosen cosmetic hue (a stray index falls back to the default), every other
// entity uses its sprite's dominant body colour (the sprite `defaultKey`). One
// lookup off the shared sprite/palette data so the tint can't drift from the art.
export function entityTint(e: Entity): Tint {
	const quad =
		e.cosmetics !== undefined
			? (HUES[e.cosmetics.hue] ?? HUES[0])
			: (BODY_PALETTE[spriteFor(e.type).defaultKey] ?? BODY_PALETTE.p);
	return { r: quad[0], g: quad[1], b: quad[2] };
}

// The gore Effect a death emits (ADR 0013, #139): a high-intensity radial (dir 0)
// burst at the dying entity's centre, tinted to the dead entity's body colour, so
// a kill sprays in every direction with chunkier, entity-coloured gore — visibly
// distinct from a chip hit's fine maroon blood. Shared so Monster and Avatar death
// — server and offline — produce identical bursts. Carries no `source`: it is sent
// to everyone in range (the killer sees it too).
export function deathGoreEffect(e: Entity): Effect {
	return {
		kind: 'gore',
		x: e.x + BOX.w / 2,
		y: e.y + BOX.h / 2,
		intensity: COMBAT.deathBurstIntensity,
		dir: 0,
		tint: entityTint(e),
	};
}

export function entityBox(e: Entity): Box {
	return { x: e.x, y: e.y, w: BOX.w, h: BOX.h };
}

export function meleeHitbox(p: Entity): Box {
	const w = COMBAT.meleeReach;
	return {
		x: p.facing === 1 ? p.x + BOX.w : p.x - w,
		y: p.y,
		w,
		h: BOX.h,
	};
}

export function aabbOverlap(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

// The blood Effect a landed hit on a Monster emits (ADR 0013): one burst at the
// Monster's centre, biased along the attacker's facing, scaled by the damage
// dealt. Shared so the authoritative `stepZone` and the client's outgoing-hit
// prediction produce identical Effects. `source` attributes the burst to the
// attacking session for originator-suppression; the client predictor omits it
// (predicted Effects are never reported upward).
export function bloodEffect(
	m: Entity,
	attackerFacing: Facing,
	damage: number,
	source?: number,
): Effect {
	const e: Effect = {
		kind: 'blood',
		x: m.x + BOX.w / 2,
		y: m.y + BOX.h / 2,
		intensity: damage,
		dir: attackerFacing,
	};
	if (source !== undefined) e.source = source;
	return e;
}

// The blood Effect an Avatar taking damage emits (ADR 0013, #132): one burst at
// the Avatar's centre, biased AWAY from the damage source (`dir` 0 = radial when
// the direction is ambiguous), scaled by the damage taken. Unlike monster-hit
// blood this is server-sourced only — never predicted — and carries NO `source`,
// so the per-recipient snapshot filter delivers it to everyone in range including
// the victim, landing in sync with the hurt-flash.
export function hurtBloodEffect(
	a: Entity,
	dir: -1 | 0 | 1,
	damage: number,
): Effect {
	return {
		kind: 'blood',
		x: a.x + BOX.w / 2,
		y: a.y + BOX.h / 2,
		intensity: damage,
		dir,
	};
}

// The blood Effects the local Avatar's outgoing hit produces this tick, mirroring
// stepZone's monster-hit emission (same i-frame gate, centre, dir, intensity) so
// the predicted burst matches the authoritative one the server suppresses back to
// the attacker (ADR 0013). Pure; the client feeds these straight to its particle
// system for zero-latency feedback. No rollback on mispredict — a stray splat on
// a swing the server scores as a miss is acceptable.
export function predictHitEffects(
	hitbox: Box,
	attackerFacing: Facing,
	damage: number,
	monsters: Entity[],
): Effect[] {
	const effects: Effect[] = [];
	for (const m of monsters)
		if (m.hurtT <= 0 && aabbOverlap(hitbox, entityBox(m)))
			effects.push(bloodEffect(m, attackerFacing, damage));
	return effects;
}
