import { describe, expect, test } from 'bun:test';
import type { CombatEvent } from '@mmo/core/combat';
import { combatEventAt, deathEvent, swatEvent } from '@mmo/core/combat';
import { decodeServerMessage, encodeServerMessage } from '@mmo/core/protocol';
import { applyKick, CAMERA_KICK, NO_KICK } from '../src/effects/camera-kick';
import { isFrozen, NO_HITSTOP, triggerHitstop } from '../src/effects/hitstop';
import { advanceParticles, ParticleSystem } from '../src/effects/particles';
import { effectsOf, type VisualEffect } from '../src/effects/project';
import { REALIZE, spawnEffects } from '../src/effects/realize';
import { effectSoundCues } from '../src/sound/world';
import { entity, flatTerrain, makeProjectile, seededRng } from './helpers';

const SEED = 0x5eed;
const TARGET = entity({ id: 9, type: 'chaser', x: 20, y: 8 });

const EVENTS: Record<string, CombatEvent> = {
	hit: combatEventAt('hit', TARGET, 1, 7, 1),
	break: combatEventAt('break', TARGET, -1, 5),
	death: deathEvent(entity({ id: 9, type: 'brute', x: 20, y: 8 })),
	swat: swatEvent(makeProjectile({ id: 3, x: 20, y: 8, vx: -9 }), -1),
};

/**
 * The owner predicts locally: `effectsOf` runs on the CombatEvent it just minted.
 * An observer receives the server's projection of the same event over the wire.
 */
function ownerProjection(event: CombatEvent): VisualEffect[] {
	return effectsOf(event);
}

function observerProjection(event: CombatEvent): VisualEffect[] {
	const wire = encodeServerMessage({
		t: 'snapshot',
		tick: 1,
		zoneId: 'town',
		avatars: [],
		monsters: [],
		projectiles: [],
		events: [event],
		drops: [],
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: [],
	});
	const msg = decodeServerMessage(wire);
	if (msg.t !== 'snapshot') throw new Error('expected a snapshot');
	return msg.events.flatMap(effectsOf);
}

/** The realized VisualEffect: the particles a projection spawns, plus the view shake it drives. */
function realize(effects: VisualEffect[]) {
	const sys = new ParticleSystem(64);
	spawnEffects(sys, effects, seededRng(SEED));
	advanceParticles(sys, 16, flatTerrain(64, 24));

	let kick = NO_KICK;
	let hitstop = NO_HITSTOP;
	for (const fx of effects) {
		const realization = REALIZE[fx.kind];
		if (realization.kick)
			kick = applyKick(kick, fx.dir * CAMERA_KICK.maxCells, -1);
		if (realization.hitstop) hitstop = triggerHitstop(hitstop);
	}

	return {
		particles: sys.particles.filter((p) => p.active),
		kick,
		frozen: isFrozen(hitstop),
		sounds: effectSoundCues(effects, 20, 30),
	};
}

describe('a CombatEvent projects to the same VisualEffect for its owner and an observer', () => {
	for (const [kind, event] of Object.entries(EVENTS)) {
		test(`a ${kind} agrees across predict and receive`, () => {
			const owner = ownerProjection(event);
			const observer = observerProjection(event);

			// `source` is server-internal — it suppresses the echo and never crosses the wire,
			// and effectsOf already drops it when projecting to a VisualEffect.
			expect(owner).toEqual(observer);
			expect(realize(owner)).toEqual(realize(observer));
		});
	}
});

test('a death keeps its tint across the wire, so the gore matches the entity that died', () => {
	const [observed] = observerProjection(EVENTS.death);

	expect(observed.tint).toEqual(effectsOf(EVENTS.death)[0].tint);
	expect(observed.tint).toBeDefined();
});
