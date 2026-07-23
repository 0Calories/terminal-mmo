import { expect, test } from 'bun:test';
import { attackPhaseAt, COMBAT, meleeKnockback } from '../../src/combat';
import type { AttackPhase, Entity } from '../../src/entities';
import { ARCHETYPES, spawnMonster } from '../../src/entities';
import { snapshotFor } from '../../src/world';
import type { ServerAvatar, ZoneState } from '../../src/zones';
import { stepZone } from '../../src/zones';
import { holdAt, SPAWN_Y, serverAvatar, zoneWith } from '../helpers';

const MELEE = ARCHETYPES.slime.melee;
const POUNCE = MELEE.pounce;
if (!POUNCE) throw new Error('the slime profile must author pounce timings');

function groundedSlime(x: number): Entity {
	const m = spawnMonster('slime', 2, x, SPAWN_Y);
	m.onGround = true;
	return m;
}

function stateWith(slime: Entity, av: ServerAvatar): ZoneState {
	return { zone: zoneWith([slime]), avatars: [av], tick: 0 };
}

const step = (state: ZoneState) =>
	stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);

const slimePhase = (m: Entity): AttackPhase | null =>
	attackPhaseAt(m.attackT, POUNCE);

test('the slime pounce commits only within leap range and off cooldown', () => {
	const inRange = stateWith(
		groundedSlime(20 + MELEE.range),
		serverAvatar(7, 20),
	);
	const committed = step(inRange);
	expect(committed.zone.monsters[0].attackT).toBeGreaterThan(0);
	const snap = snapshotFor(committed, 7);
	expect(snap.monsters[0].action.move).toBe('basic');
	expect(snap.monsters[0].action.phase).toBe('windup');

	const outOfRange = stateWith(
		groundedSlime(20 + MELEE.range + 3),
		serverAvatar(7, 20),
	);
	expect(step(outOfRange).zone.monsters[0].attackT).toBe(0);

	const cooling = groundedSlime(20 + MELEE.range);
	cooling.attackCdT = 5;
	expect(
		step(stateWith(cooling, serverAvatar(7, 20))).zone.monsters[0].attackT,
	).toBe(0);
});

test('wind-up squats on the ground; the Strike exists exactly while airborne', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 999;
	let state = stateWith(groundedSlime(20 + MELEE.range), av);

	let sawWindup = false;
	let sawRecovery = false;
	let damageTicks = 0;
	for (let i = 0; i < 200; i++) {
		const hpBefore = state.avatars[0].avatar.hp;
		state = step(state);
		const m = state.zone.monsters[0];
		const hurt = state.avatars[0].avatar.hp < hpBefore;
		const phase = slimePhase(m);
		if (phase === 'windup') {
			sawWindup = true;
			expect(m.onGround).toBe(true);
			expect(hurt).toBe(false);
		}
		if (phase === 'recovery') {
			sawRecovery = true;
			expect(hurt).toBe(false);
		}
		if (hurt) {
			damageTicks++;
			expect(phase).toBe('active');
			expect(m.onGround).toBe(false);
		}
	}
	expect(sawWindup).toBe(true);
	expect(sawRecovery).toBe(true);
	expect(damageTicks).toBe(1);
	expect(999 - state.avatars[0].avatar.hp).toBe(MELEE.damage);
});

test('the leap arc is locked at commit: a target that moves is not tracked', () => {
	const start = 20 + MELEE.range;
	let state = stateWith(groundedSlime(start), serverAvatar(7, 20));
	state = step(state);
	expect(state.zone.monsters[0].attackT).toBeGreaterThan(0);
	expect(state.zone.monsters[0].facing).toBe(-1);

	// The target flees the moment the slime commits.
	for (let i = 0; i < 200; i++) {
		const a = state.avatars[0].avatar;
		state = stepZone(state, [{ ...holdAt(7, a), x: 120 }], 16);
		const m = state.zone.monsters[0];
		if (m.attackT > 0) expect(m.facing).toBe(-1);
		if (m.attackT === 0 && m.onGround) break;
	}
	const landed = state.zone.monsters[0];
	expect(landed.x).toBeLessThan(start - MELEE.range / 2);
});

test('landing begins the wobble recovery; the cooldown gates chaining', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hurtT = 100;
	let state = stateWith(groundedSlime(20 + MELEE.range), av);

	let airborne = false;
	let landedInRecovery = false;
	for (let i = 0; i < 200 && !landedInRecovery; i++) {
		state = step(state);
		const m = state.zone.monsters[0];
		if (m.attackT > 0 && !m.onGround) airborne = true;
		if (airborne && m.onGround) {
			landedInRecovery = true;
			expect(slimePhase(m)).toBe('recovery');
		}
	}
	expect(landedInRecovery).toBe(true);

	let recoveryTicks = 0;
	while (state.zone.monsters[0].attackT > 0) {
		expect(slimePhase(state.zone.monsters[0])).toBe('recovery');
		state = step(state);
		recoveryTicks++;
	}
	expect(recoveryTicks).toBeGreaterThan(0);
	expect(state.zone.monsters[0].attackCdT ?? 0).toBeGreaterThan(1);

	let gapTicks = 0;
	while (state.zone.monsters[0].attackT === 0 && gapTicks < 1000) {
		state = step(state);
		gapTicks++;
	}
	expect(state.zone.monsters[0].attackT).toBeGreaterThan(0);
	expect(gapTicks * 16).toBeGreaterThanOrEqual(1000);
});

test('a connecting pounce shoves a poise-broken Avatar with the scaled knockback', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 999;
	av.avatar.poise = 1;
	let state = stateWith(groundedSlime(20 + MELEE.range), av);
	let shoved = false;
	for (let i = 0; i < 200 && !shoved; i++) {
		state = step(state);
		if ((state.avatars[0].avatar.stunT ?? 0) > 0) {
			shoved = true;
			const ivx = state.avatars[0].avatar.ivx ?? 0;
			expect(ivx).toBeLessThan(0);
			expect(Math.abs(ivx)).toBeCloseTo(meleeKnockback(MELEE).knockback, 5);
			expect(Math.abs(ivx)).toBeGreaterThan(COMBAT.knockback);
		}
	}
	expect(shoved).toBe(true);
});
