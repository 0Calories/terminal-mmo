import type { Box, Effect, Entity, Input, Terrain } from '@mmo/core';
import {
	applyImpulse,
	COMBAT,
	canStartDodge,
	capabilityUnlocked,
	clientStepAvatar,
	effectsOf,
	emoteById,
	initialEmoteT,
	PHYS,
	predictHits,
	SPAWN,
	spawnAvatar,
	stepAvatarCombat,
	weaponById,
} from '@mmo/core';

export function spawnPredicted(weapon: number): Entity {
	return { ...spawnAvatar(SPAWN.x, SPAWN.y), weapon };
}

// A zone change teleports the Avatar: take the server's arrival point and kill inherited velocity.
export function arriveInZone(
	predicted: Entity,
	arrival: Pick<Entity, 'x' | 'y'>,
): Entity {
	return {
		...predicted,
		x: arrival.x,
		y: arrival.y,
		vx: 0,
		vy: 0,
		onGround: false,
	};
}

export interface PredictContext {
	terrain: Terrain;
	level: number;
	dtMs: number;
}

export interface PredictResult {
	avatar: Entity;
	dodging: boolean;
	hitbox: Box | null;
	hitDamage: number;
}

export function stepPrediction(
	prev: Entity,
	inp: Input,
	ctx: PredictContext,
): PredictResult {
	// Apply the dodge impulse before physics so clientStepAvatar integrates it this frame.
	const dodging =
		(inp.dodge ?? false) &&
		canStartDodge(prev, inp.moveX) &&
		capabilityUnlocked('dodge', ctx.level);
	let avatar = dodging
		? applyImpulse(prev, inp.moveX * COMBAT.dodge.impulse, -COMBAT.dodge.up)
		: prev;

	avatar = clientStepAvatar(
		ctx.terrain,
		avatar,
		{ moveX: inp.moveX, jump: inp.jump },
		ctx.dtMs,
	);

	// Must fold through the same shared function the server runs, else prediction diverges.
	const fold = stepAvatarCombat(
		avatar,
		{
			attack: inp.attack,
			skill: inp.skill,
			dodge: dodging,
			guard: inp.guard,
		},
		{
			level: ctx.level,
			cls: 'warrior',
			weapon: weaponById(avatar.weapon),
			dt: Math.min(ctx.dtMs / 1000, PHYS.maxDt),
		},
	);
	const strike = fold.strikes[0];
	return {
		avatar: fold.avatar,
		dodging,
		hitbox: strike?.hitbox ?? null,
		hitDamage: strike?.damage ?? 0,
	};
}

/**
 * Health is authoritative; position is not. The snapshot echoes our pos ~1 RTT stale,
 * so snapping to it would drag the Avatar backward.
 */
export function reconcileHealth(
	predicted: Entity,
	own: Pick<Entity, 'hp' | 'maxHp' | 'hurtT'>,
): void {
	predicted.hp = own.hp;
	predicted.maxHp = own.maxHp;
	predicted.hurtT = own.hurtT;
}

/**
 * Show this swing's hits immediately rather than waiting a round trip. Records the
 * targets on `predicted.swingHits` so one swing can't hit the same monster twice.
 */
export function predictSwingEffects(
	predicted: Entity,
	hitbox: Box,
	hitDamage: number,
	monsters: Entity[],
): Effect[] {
	const swung = new Set(predicted.swingHits ?? []);
	const events = predictHits(
		hitbox,
		predicted.facing,
		hitDamage,
		swung,
		monsters,
	);
	for (const e of events) swung.add(e.targetId);
	predicted.swingHits = [...swung];
	return events.flatMap(effectsOf);
}

export function applyEmote(predicted: Entity, emote: string): Entity {
	const def = emoteById(emote);
	if (!def) return predicted;
	return { ...predicted, emoteId: def.id, emoteT: initialEmoteT(def) };
}
