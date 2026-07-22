import { expect, test } from 'bun:test';
import {
	COMBAT,
	type Combatant,
	resolveHitsOnAvatars,
	resolveHitsOnMonsters,
} from '../../src/combat';
import { BOX, type Faction, type Strike } from '../../src/entities';

const target: Combatant = {
	id: 7,
	x: 20,
	y: 10,
	facing: 1,
	onGround: true,
	hp: 100,
	hurtT: 0,
	attackT: 0,
	vy: 0,
};

function strike(faction: Faction): Strike {
	return {
		attackerId: 1,
		attackerKind: faction === 'players' ? 'avatar' : 'monster',
		faction,
		hitbox: { x: target.x, y: target.y, w: BOX.w, h: BOX.h },
		damage: COMBAT.meleeDamage,
		poiseDamage: COMBAT.poiseDamage,
		facing: 1,
		knockback: COMBAT.knockback,
		knockbackUp: COMBAT.knockbackUp,
	};
}

const factionLaws = [
	{
		name: 'monster targets',
		opposing: 'players',
		same: 'monsters',
		resolve: (strikes: Strike[]) => {
			const swingHits = new Map<number, Set<number>>();
			const result = resolveHitsOnMonsters([target], strikes, swingHits);
			return { target: result.monsters[0], events: result.events, swingHits };
		},
	},
	{
		name: 'Avatar targets',
		opposing: 'monsters',
		same: 'players',
		resolve: (strikes: Strike[]) => {
			const swingHits = new Map<number, Set<number>>();
			const result = resolveHitsOnAvatars([target], strikes, swingHits);
			return { target: result.avatars[0], events: result.events, swingHits };
		},
	},
] as const;

for (const law of factionLaws) {
	test(`${law.name} accept only opposing-faction strikes`, () => {
		const hit = law.resolve([strike(law.opposing)]);
		const filtered = law.resolve([strike(law.same)]);

		expect(target.hp - hit.target.hp).toBe(COMBAT.meleeDamage);
		expect(hit.events).toHaveLength(1);
		expect(filtered).toEqual({ target, events: [], swingHits: new Map() });
	});
}
