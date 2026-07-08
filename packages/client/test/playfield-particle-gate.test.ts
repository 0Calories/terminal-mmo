import { expect, test } from 'bun:test';
import type { Effect } from '@mmo/shared';
import { PlayfieldRenderable } from '../src/playfield';

// The gate consumes snapshot Effects once per sim tick so a faster render loop can't
// double-spawn a burst. #268: it must also reset on a zone change, or entry effects
// whose tick collides with the old zone's get swallowed. Exercised directly, bypassing
// the Renderable's RenderContext.

type Gate = {
	lastParticleTick: number;
	lastZoneId: string | null;
	consumeSnapshotEffects(
		zoneId: string,
		tick: number,
		effects: Effect[],
	): Effect[];
};

function makeGate(): Gate {
	const pf = Object.create(PlayfieldRenderable.prototype) as Gate;
	pf.lastParticleTick = -1;
	pf.lastZoneId = null;
	return pf;
}

const fx = (): Effect[] => [
	{ kind: 'blood', x: 0, y: 0, intensity: 1, dir: 1 },
];

test('effects fire once per sim tick and are suppressed on a repeated tick', () => {
	const g = makeGate();
	expect(g.consumeSnapshotEffects('town', 5, fx())).toHaveLength(1);
	// Same tick re-observed by a faster render loop: no double-spawn.
	expect(g.consumeSnapshotEffects('town', 5, fx())).toHaveLength(0);
	expect(g.consumeSnapshotEffects('town', 6, fx())).toHaveLength(1);
});

test('a zone change resets the gate so entry effects fire even on a colliding tick', () => {
	const g = makeGate();
	expect(g.consumeSnapshotEffects('town', 5, fx())).toHaveLength(1);
	// The dungeon's first snapshot lands on the SAME tick number — without the reset
	// this would be swallowed.
	expect(g.consumeSnapshotEffects('dungeon', 5, fx())).toHaveLength(1);
	expect(g.consumeSnapshotEffects('dungeon', 5, fx())).toHaveLength(0);
	expect(g.consumeSnapshotEffects('dungeon', 6, fx())).toHaveLength(1);
});
