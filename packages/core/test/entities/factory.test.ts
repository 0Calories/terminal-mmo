import { expect, test } from 'bun:test';
import { spawnMonster } from '../../src/entities';
import { applyImpulse, DEFAULT_MASS } from '../../src/physics';

test('the slime spawns lighter than default: the same impulse shoves it visibly further', () => {
	const slime = spawnMonster('slime', 2, 10, 10);
	const chaser = spawnMonster('chaser', 3, 10, 10);
	expect(slime.mass ?? DEFAULT_MASS).toBeLessThan(DEFAULT_MASS);
	const shove = 30;
	const shovedSlime = applyImpulse(slime, shove, 0);
	const shovedChaser = applyImpulse(chaser, shove, 0);
	expect(shovedSlime.ivx ?? 0).toBeGreaterThan(shovedChaser.ivx ?? 0);
});

test('the slime inherits the intro-monster survivability the chaser outgrew', () => {
	const slime = spawnMonster('slime', 2, 10, 10);
	const chaser = spawnMonster('chaser', 3, 10, 10);
	expect(slime.hp).toBeLessThan(chaser.hp);
});
