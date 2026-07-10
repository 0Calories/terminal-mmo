import { describe, expect, test } from 'bun:test';
import {
	type CombatEvent,
	combatEventAt,
	deathEvent,
	swatEvent,
} from '@mmo/core/combat';
import { decodeServerMessage, encodeServerMessage } from '@mmo/core/protocol';
import { NO_HITSTOP, triggerHitstop } from '../src/game/hitstop';
import { EFFECTS } from '../src/particles/effects';
import { advanceSpecks, Pool, spawnSpeck } from '../src/particles/engine';
import { applyKick, CAMERA_KICK, NO_KICK } from '../src/render/camera';
import { type Presentation, present } from '../src/render/present';
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
 * The owner predicts locally: `present` runs on the CombatEvent it just minted.
 * An observer receives the server's broadcast of the same event over the wire.
 */
function ownerProjection(event: CombatEvent): Presentation {
	return present([event]);
}

function observerProjection(event: CombatEvent): Presentation {
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
	return present(msg.events);
}

/** The realized presentation: the specks a routing spawns, plus the view shake and freeze it drives. */
function realize(show: Presentation) {
	const pool = new Pool(64);
	const rng = seededRng(SEED);
	for (const fx of show.effects) {
		const def = EFFECTS[fx.kind];
		for (let i = 0; i < def.count(fx.intensity); i++)
			spawnSpeck(pool, def.profile, fx.x, fx.y, fx.dir, rng, fx.tint);
	}
	advanceSpecks(pool, 16, flatTerrain(64, 24));

	let kick = NO_KICK;
	for (const dir of show.kicks)
		kick = applyKick(kick, dir * CAMERA_KICK.maxCells, -1);

	return {
		specks: pool.specks.filter((p) => p.active),
		kick,
		hitstop: show.hitstop ? triggerHitstop(NO_HITSTOP) : NO_HITSTOP,
		sounds: effectSoundCues(show.effects, 20, 30),
	};
}

describe('a CombatEvent routes to the same presentation for its owner and an observer', () => {
	for (const [kind, event] of Object.entries(EVENTS)) {
		test(`a ${kind} agrees across predict and receive`, () => {
			const owner = ownerProjection(event);
			const observer = observerProjection(event);

			// `source` is server-internal — it suppresses the echo and never crosses the wire,
			// and present already drops it when routing to presentation.
			expect(owner).toEqual(observer);
			expect(realize(owner)).toEqual(realize(observer));
		});
	}
});

test('a death keeps its tint across the wire, so the gore matches the entity that died', () => {
	const [observed] = observerProjection(EVENTS.death).effects;

	expect(observed.tint).toEqual(present([EVENTS.death]).effects[0].tint);
	expect(observed.tint).toBeDefined();
});
