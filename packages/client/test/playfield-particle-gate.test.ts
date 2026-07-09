import { expect, test } from 'bun:test';
import type { Effect } from '@mmo/shared';
import { PlayfieldRenderable } from '../src/playfield';

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
	expect(g.consumeSnapshotEffects('town', 5, fx())).toHaveLength(0);
	expect(g.consumeSnapshotEffects('town', 6, fx())).toHaveLength(1);
});

test('a zone change resets the gate so entry effects fire even on a colliding tick', () => {
	const g = makeGate();
	expect(g.consumeSnapshotEffects('town', 5, fx())).toHaveLength(1);
	// dungeon's first snapshot reuses tick 5; without the reset it would be swallowed
	expect(g.consumeSnapshotEffects('dungeon', 5, fx())).toHaveLength(1);
	expect(g.consumeSnapshotEffects('dungeon', 5, fx())).toHaveLength(0);
	expect(g.consumeSnapshotEffects('dungeon', 6, fx())).toHaveLength(1);
});
