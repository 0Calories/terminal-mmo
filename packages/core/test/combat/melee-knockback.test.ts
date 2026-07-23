import { expect, test } from 'bun:test';
import { COMBAT, meleeKnockback } from '../../src/combat';
import { ARCHETYPES } from '../../src/entities';

test('an unset knockback scalar reproduces the shared Strike impulse exactly', () => {
	expect(meleeKnockback(ARCHETYPES.chaser.melee)).toEqual({
		knockback: COMBAT.knockback,
		knockbackUp: COMBAT.knockbackUp,
	});
	expect(meleeKnockback(ARCHETYPES.brute.melee)).toEqual({
		knockback: COMBAT.knockback,
		knockbackUp: COMBAT.knockbackUp,
	});
});

test('a knockback scalar multiplies both components of the Strike impulse', () => {
	const p = { ...ARCHETYPES.chaser.melee, knockback: 2.5 };
	expect(meleeKnockback(p)).toEqual({
		knockback: COMBAT.knockback * 2.5,
		knockbackUp: COMBAT.knockbackUp * 2.5,
	});
});
