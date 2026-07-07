import { expect, test } from 'bun:test';
import type { Effect } from '@mmo/shared';
import { PlayfieldRenderable } from '../src/playfield';

// The per-tick dedup gate consumes snapshot Effects exactly once per sim tick, so a
// faster render loop can't spawn the same burst twice. Exercise the extracted gate
// directly (bypassing the Renderable's RenderContext) to lock in its behaviour and the
// #268 fix: the gate must reset on a zone change so entry effects — particles and their
// voices — are never swallowed when the new zone's tick collides with the old one's.

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
	// Next tick fires again.
	expect(g.consumeSnapshotEffects('town', 6, fx())).toHaveLength(1);
});

test('a zone change resets the gate so entry effects fire even on a colliding tick', () => {
	const g = makeGate();
	// Consume tick 5 in town.
	expect(g.consumeSnapshotEffects('town', 5, fx())).toHaveLength(1);
	// Enter the dungeon whose first snapshot lands on the SAME tick number. Without the
	// reset this would be swallowed; the zone change must let it through.
	expect(g.consumeSnapshotEffects('dungeon', 5, fx())).toHaveLength(1);
	// And it re-arms per tick inside the new zone.
	expect(g.consumeSnapshotEffects('dungeon', 5, fx())).toHaveLength(0);
	expect(g.consumeSnapshotEffects('dungeon', 6, fx())).toHaveLength(1);
});
