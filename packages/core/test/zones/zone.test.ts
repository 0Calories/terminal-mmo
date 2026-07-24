import { expect, test } from 'bun:test';
import {
	ACTION_FLAG,
	applyPoiseDamage,
	COMBAT,
	DEFAULT_WEAPON,
	DODGE_TOTAL,
	dodgePhase,
	entityTint,
	SWING_TOTAL,
	swingPhase,
	weaponById,
} from '../../src/combat';
import type { Drop, Entity, Item } from '../../src/entities';
import {
	ARCHETYPES,
	BOX,
	DEFAULT_COSMETICS,
	spawnAvatar,
	spawnMonster,
} from '../../src/entities';
import { lootTableFor, rollDrop } from '../../src/items';
import { CAPABILITY_UNLOCK, xpForKill } from '../../src/progression';
import { decodeServerMessage, encodeServerMessage } from '../../src/protocol';
import { addAvatar, removeAvatar, snapshotFor } from '../../src/world';
import type { AvatarIntent, ServerAvatar, ZoneState } from '../../src/zones';
import {
	clientStepAvatar,
	createZoneState,
	GROUND_TOP,
	SPAWN,
	stepZone,
	type Zone,
} from '../../src/zones';
import { flatTerrain, islandTerrain, makeProjectile } from '../helpers';

const y = GROUND_TOP - BOX.h;
const TEST_ZONE_ID = 'test-zone';

function serverAvatar(
	sessionId: number,
	x: number,
	handle = 'hero',
	level = 1,
): ServerAvatar {
	return {
		sessionId,
		handle,
		cosmetics: DEFAULT_COSMETICS,
		avatar: { ...spawnAvatar(x, y), id: sessionId },
		progress: { level, xp: 0, gold: 0 },
		inventory: [],
		log: [],
		nextId: 1,
		rngState: 1,
	};
}

function zoneWith(monsters: Entity[], id = TEST_ZONE_ID): Zone {
	return {
		id,
		type: 'field',
		terrain: flatTerrain(),
		monsters,
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		portals: [],
		nextMonsterId: 100,
	};
}

const MID_ACTIVE = SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
function primeSwing(av: ServerAvatar): ServerAvatar {
	av.avatar.attackT = MID_ACTIVE;
	return av;
}

function strikingCommitterAt20(): Entity {
	const m = spawnMonster('chaser', 2, 16, y);
	m.onGround = true;
	m.facing = 1;
	m.attackT = MID_ACTIVE;
	return m;
}

function holdAt(sessionId: number, e: Entity): AvatarIntent {
	return {
		sessionId,
		x: e.x,
		y: e.y,
		vx: 0,
		vy: 0,
		facing: e.facing,
		onGround: e.onGround,
		attack: false,
	};
}

test('Player melee damage is confined to the active swing phase', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	const av = serverAvatar(7, 20);
	av.avatar.facing = 1;
	av.avatar.hurtT = 5;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	let sawWindupNoDamage = false;
	let hitPhase: string | null = null;
	let prevHp = m.hp;
	for (let i = 0; i < 40 && hitPhase === null; i++) {
		const a = state.avatars[0].avatar;
		state = stepZone(state, [{ ...holdAt(7, a), attack: true }], 16);
		const hp = state.zone.monsters[0]?.hp ?? 0;
		const phase = swingPhase(state.avatars[0].avatar.attackT);
		if (phase === 'windup' && hp === prevHp) sawWindupNoDamage = true;
		if (hp < prevHp) hitPhase = phase;
		prevHp = hp;
	}
	expect(sawWindupNoDamage).toBe(true);
	expect(hitPhase).toBe('active');
});

test('no CombatEvent is emitted when the hit lands on an i-framed Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hurtT = 0.5;
	const av = serverAvatar(7, 20);
	av.avatar.hurtT = 1;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters[0].hp).toBe(ARCHETYPES.chaser.hp);
	expect(next.events ?? []).toEqual([]);
});

test('a far contributor leaves its instanced Drop resting, then collects it on touch', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = weaponById(DEFAULT_WEAPON).damage;
	m.contributors = [7, 8];
	const killer = primeSwing(serverAvatar(7, 20));
	const helper = serverAvatar(8, 300);
	let state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [killer, helper],
		tick: 0,
	};
	state = stepZone(
		state,
		[{ ...holdAt(7, killer.avatar), attack: true }, holdAt(8, helper.avatar)],
		16,
	);
	expect(state.avatars[1].inventory.length).toBe(0);
	const resting = (state.zone.drops ?? []).filter((d) => d.owner === 8);
	expect(resting.length).toBe(1);
	const d = resting[0];
	const onDrop: AvatarIntent = {
		...holdAt(8, state.avatars[1].avatar),
		x: d.x,
		y: d.y,
	};
	state = stepZone(state, [holdAt(7, state.avatars[0].avatar), onDrop], 16);
	expect(state.avatars[1].inventory.length).toBe(1);
	expect((state.zone.drops ?? []).some((x) => x.owner === 8)).toBe(false);
});

test('a Monster dying emits a radial, high-intensity death CombatEvent at the Monster, tinted by its body', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = weaponById(DEFAULT_WEAPON).damage;
	const av = primeSwing(serverAvatar(7, 20));
	av.avatar.facing = 1;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters.length).toBe(0);
	const death = next.events?.find((ev) => ev.dir === 0);
	expect(death?.kind).toBe('death');
	expect(death?.kind === 'death' && death.tint).toEqual(entityTint(m));
	expect(death?.intensity).toBe(COMBAT.deathBurstIntensity);
	expect(death?.x).toBeGreaterThanOrEqual(m.x);
	expect(death?.x).toBeLessThanOrEqual(m.x + BOX.w);
	const chip = next.events?.find((ev) => ev.dir !== 0);
	expect(death?.intensity).toBeGreaterThan(chip?.intensity ?? 0);
});

test.each([
	'chaser',
	'brute',
] as const)('%s melee damage lands only in the active phase', (type) => {
	const profile = ARCHETYPES[type].melee;
	const m = spawnMonster(type, 2, 20 + profile.range, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	av.avatar.hp = 999;
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };

	state = stepZone(state, [holdAt(7, av.avatar)], 16);
	const snap = snapshotFor(state, 7);
	expect(snap.monsters[0].action.move).toBe('basic');
	expect(snap.monsters[0].action.phase).toBe('windup');
	expect(state.avatars[0].avatar.hp).toBe(before);

	let damagedPhase: string | undefined;
	const maxSwingTicks = Math.ceil((SWING_TOTAL * 1000) / 16) + 1;
	for (let i = 0; i < maxSwingTicks && damagedPhase === undefined; i++) {
		const hpBefore = state.avatars[0].avatar.hp;
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		if (state.avatars[0].avatar.hp < hpBefore)
			damagedPhase = swingPhase(state.zone.monsters[0].attackT) ?? 'idle';
	}
	expect(damagedPhase).toBe('active');
	expect(before - state.avatars[0].avatar.hp).toBe(profile.damage);
});

test('a committer cannot re-attack during its recovery — a punishable opening', () => {
	const m = spawnMonster('chaser', 2, 20 + ARCHETYPES.chaser.melee.range, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };

	state.avatars[0].avatar.hurtT = 100;

	let sawRecovery = false;
	for (let i = 0; i < 40; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		const mon = state.zone.monsters[0];
		if (swingPhase(mon.attackT) === 'recovery') {
			sawRecovery = true;
			const punisher = primeSwing(
				serverAvatar(9, 20 + ARCHETYPES.chaser.melee.range - BOX.w),
			);
			punisher.avatar.facing = 1;
			const hpBefore = mon.hp;
			const punished = stepZone(
				{ ...state, avatars: [...state.avatars, punisher] },
				[
					holdAt(7, state.avatars[0].avatar),
					{ ...holdAt(9, punisher.avatar), attack: true },
				],
				16,
			);
			expect(punished.zone.monsters[0].hp).toBeLessThan(hpBefore);
			break;
		}
	}
	expect(sawRecovery).toBe(true);
});

test('a committer in its active phase can Stagger a poise-broken Avatar (full hit-reaction payload)', () => {
	const m = spawnMonster('chaser', 2, 20 + ARCHETYPES.chaser.melee.range, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	av.avatar.poise = 1;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	let staggered = false;
	for (let i = 0; i < 30 && !staggered; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		if ((state.avatars[0].avatar.stunT ?? 0) > 0) staggered = true;
	}
	expect(staggered).toBe(true);
	expect(state.avatars[0].avatar.ivx ?? 0).not.toBe(0);
	expect(state.events?.some((e) => e.kind === 'break')).toBe(true);
});

test('the brute is a poise-tank: it spawns with a much larger Poise pool than the default', () => {
	const m = spawnMonster('brute', 2, 30, y);
	expect(m.poiseMax).toBe(ARCHETYPES.brute.poiseMax);
	expect(ARCHETYPES.brute.poiseMax).toBeGreaterThan(COMBAT.poise.max);
	const r = applyPoiseDamage(m, COMBAT.poiseDamage);
	expect(r.broke).toBe(false);
	expect(
		Math.ceil(ARCHETYPES.brute.poiseMax / COMBAT.poiseDamage),
	).toBeGreaterThan(Math.ceil(COMBAT.poise.max / COMBAT.poiseDamage));
});

test('the brute attacks deliberately: a commit cool-down keeps it from re-swinging the instant it recovers', () => {
	const m = spawnMonster('brute', 2, 20 + ARCHETYPES.brute.melee.range, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);

	av.avatar.hurtT = 100;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };

	let sawSwing = false;
	for (let i = 0; i < 60; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		const at = state.zone.monsters[0].attackT;
		if (at > 0) sawSwing = true;
		if (sawSwing && at === 0) break;
	}
	expect(sawSwing).toBe(true);
	expect(state.zone.monsters[0].attackCdT ?? 0).toBeGreaterThan(0);
	state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
	expect(state.zone.monsters[0].attackT).toBe(0);

	let reCommitted = false;
	for (let i = 0; i < 200; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		if (state.zone.monsters[0].attackT > 0) {
			reCommitted = true;
			break;
		}
	}
	expect(reCommitted).toBe(true);
});

test('a Dodge negates a Monster strike during its i-frame active window', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20);

	av.avatar.dodgeT = COMBAT.dodge.recovery + COMBAT.dodge.active * 0.5;
	const before = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(before);
	expect(next.avatars[0].avatar.hurtT).toBe(0);
	expect(next.events ?? []).toEqual([]);
});

test('a Dodge in its recovery window does NOT grant i-frames — the hit connects', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20);
	av.avatar.dodgeT = COMBAT.dodge.recovery * 0.5;
	const before = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(
		before - ARCHETYPES.chaser.melee.damage,
	);
});

test('a Dodge slips a projectile during its active window but not its recovery', () => {
	const shot = makeProjectile({ x: 20, y, life: 1 });
	const zone: Zone = { ...zoneWith([]), projectiles: [shot] };
	const av = serverAvatar(7, 20);
	av.avatar.dodgeT = COMBAT.dodge.recovery + COMBAT.dodge.active * 0.5;
	const before = av.avatar.hp;
	const next = stepZone(
		{ zone, avatars: [av], tick: 0 },
		[holdAt(7, av.avatar)],
		16,
	);
	expect(next.avatars[0].avatar.hp).toBe(before);
	expect(next.zone.projectiles.length).toBe(1);
});

test('a dodge intent loads the i-frame timer through stepZone (active on the first tick)', () => {
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.dodge);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), dodge: true }], 16);
	const d = next.avatars[0].avatar.dodgeT ?? 0;
	expect(d).toBeGreaterThan(0);
	expect(d).toBeLessThanOrEqual(DODGE_TOTAL);
	expect(dodgePhase(d)).toBe('active');
	const snap = snapshotFor(next, 7);
	const me = snap.avatars.find((a) => a.sessionId === 7);
	expect(me?.action.move).toBe('dodge');
});

test('a Monster swing overlapping the Avatar across multiple active frames lands ONCE per swing (dedup ledger)', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
	expect(before - state.avatars[0].avatar.hp).toBe(
		ARCHETYPES.chaser.melee.damage,
	);

	for (let i = 0; i < 3; i++) {
		state.avatars[0].avatar.hurtT = 0;
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
	}
	expect(before - state.avatars[0].avatar.hp).toBe(
		ARCHETYPES.chaser.melee.damage,
	);
	expect(state.events?.some((e) => e.kind === 'break')).toBe(false);
	expect(state.avatars[0].avatar.stunT ?? 0).toBe(0);
});

test('each Monster swing gets a fresh strike-dedup ledger', () => {
	const m = spawnMonster('chaser', 2, 20 + ARCHETYPES.chaser.melee.range, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	av.avatar.hp = 999;
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const drops: number[] = [];
	let prevHp = before;
	for (let i = 0; i < 120 && drops.length < 2; i++) {
		state.avatars[0].avatar.hurtT = 0;
		const held = holdAt(7, state.avatars[0].avatar);
		state = stepZone(state, [{ ...held, x: 20, vx: 0 }], 16);
		const hp = state.avatars[0].avatar.hp;
		if (hp < prevHp) drops.push(prevHp - hp);
		prevHp = hp;
	}

	expect(drops).toEqual([
		ARCHETYPES.chaser.melee.damage,
		ARCHETYPES.chaser.melee.damage,
	]);
});

test('one active frame strikes every overlapping Avatar', () => {
	const m = strikingCommitterAt20();
	const a = serverAvatar(7, 20);
	const b = serverAvatar(8, 21);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [a, b], tick: 0 };
	state = stepZone(state, [holdAt(7, a.avatar), holdAt(8, b.avatar)], 16);
	expect(state.avatars[0].avatar.hp).toBe(
		a.avatar.maxHp - ARCHETYPES.chaser.melee.damage,
	);
	expect(state.avatars[1].avatar.hp).toBe(
		b.avatar.maxHp - ARCHETYPES.chaser.melee.damage,
	);
});

function guardIntent(
	sessionId: number,
	e: Entity,
	over: Partial<AvatarIntent> = {},
): AvatarIntent {
	return { ...holdAt(sessionId, e), guard: true, ...over };
}

test('a frontal Guard converts a strike to chip damage and drains Poise', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = -1;
	av.avatar.guardT = 0.5;
	const poiseBefore = av.avatar.poise ?? COMBAT.poise.max;
	const hpBefore = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const out = next.avatars[0].avatar;
	expect(hpBefore - out.hp).toBe(
		Math.ceil(ARCHETYPES.chaser.melee.damage * COMBAT.guard.blockChip),
	);
	expect(hpBefore - out.hp).toBeLessThan(ARCHETYPES.chaser.melee.damage);
	expect(out.poise ?? COMBAT.poise.max).toBeLessThan(poiseBefore);
	expect(out.stunT ?? 0).toBe(0);
	expect(next.events?.some((e) => e.kind === 'hit')).toBeFalsy();
});

test('an unguarded committer chip emits a source-less hit event biased away from the Monster', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	const hit = next.events?.find((e) => e.kind === 'hit');
	expect(hit?.dir).toBe(1);
	expect(hit?.kind === 'hit' && hit.source).toBeUndefined();
	expect(next.avatars[0].avatar.stunT ?? 0).toBe(0);
});

test('a Guard break Staggers the Avatar', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = -1;
	av.avatar.guardT = 0.5;
	av.avatar.poise = COMBAT.guard.blockPoise - 1;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const out = next.avatars[0].avatar;
	expect(out.stunT ?? 0).toBeGreaterThan(0);
	expect(out.ivx ?? 0).not.toBe(0);
	expect(next.events?.some((e) => e.kind === 'break')).toBe(true);
});

test('a rear strike bypasses Guard', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = 1;
	av.avatar.guardT = 0.5;
	const hpBefore = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const out = next.avatars[0].avatar;
	expect(hpBefore - out.hp).toBe(ARCHETYPES.chaser.melee.damage);
});

test('a guarding Avatar replicates the guarding flag to observers', () => {
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = -1;
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const snap = snapshotFor(next, 9);
	const flags = snap.avatars[0].action.flags;
	expect(flags & ACTION_FLAG.guarding).toBeTruthy();
});

test('a Monster targets and chases the nearest Avatar', () => {
	const m = spawnMonster('chaser', 2, 50, y);
	m.onGround = true;
	const near = serverAvatar(7, 45);
	const far = serverAvatar(8, 10);
	const state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [far, near],
		tick: 0,
	};
	const next = stepZone(
		state,
		[holdAt(8, far.avatar), holdAt(7, near.avatar)],
		16,
	);
	expect(next.zone.monsters[0].x).toBeLessThan(50);
});

test('a Slime hopping on top of an Avatar is harmless: traversal hops carry no Strike', () => {
	const m = spawnMonster('slime', 2, 20, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	for (let i = 0; i < 600; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		expect(state.events ?? []).toEqual([]);
	}
	expect(state.avatars[0].avatar.hp).toBe(before);
	expect(state.zone.monsters[0].attackT).toBe(0);
});

test('a Slime locomotes by hopping: it leaves the ground and travels', () => {
	const m = spawnMonster('slime', 2, 100, y);
	m.onGround = true;
	const startX = m.x;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [], tick: 0 };
	let airborne = false;
	for (let i = 0; i < 600; i++) {
		state = stepZone(state, [], 16);
		if (!state.zone.monsters[0].onGround) airborne = true;
	}
	expect(airborne).toBe(true);
	expect(state.zone.monsters[0].x).not.toBe(startX);
	expect(state.zone.monsters[0].onGround).toBe(true);
});

test('a patrolling Slime never hops off its platform', () => {
	const groundEnd = 30;
	const island = islandTerrain(60, groundEnd);
	const m = spawnMonster('slime', 2, 13, y);
	m.onGround = true;
	let state: ZoneState = {
		zone: { ...zoneWith([m]), terrain: island },
		avatars: [],
		tick: 0,
	};
	for (let i = 0; i < 2000; i++) {
		state = stepZone(state, [], 16);
		const s = state.zone.monsters[0];
		expect(s.y + BOX.h).toBeLessThanOrEqual(GROUND_TOP);
		expect(s.x + BOX.w).toBeLessThanOrEqual(groundEnd + 1);
	}
});

test('only the Avatar landing the kill is credited when two are present', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = weaponById(DEFAULT_WEAPON).damage;
	const attacker = primeSwing(serverAvatar(7, 20));
	const bystander = serverAvatar(8, 200);
	const state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [attacker, bystander],
		tick: 0,
	};
	const next = stepZone(
		state,
		[
			{ ...holdAt(7, attacker.avatar), attack: true },
			holdAt(8, bystander.avatar),
		],
		16,
	);
	expect(next.avatars[0].progress.xp).toBe(xpForKill('chaser', TEST_ZONE_ID));
	expect(next.avatars[0].inventory.length).toBe(1);
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
	expect(next.zone.drops ?? []).toEqual([]);
});

test('a landing hit records the attacker as a contributor on the Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = primeSwing(serverAvatar(7, 20));
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), attack: true }], 16);
	expect(next.zone.monsters[0].hp).toBeLessThan(ARCHETYPES.chaser.hp);
	expect(next.zone.monsters[0].contributors).toEqual([7]);
});

test('on death every recorded contributor earns shared XP and its own loot roll', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = weaponById(DEFAULT_WEAPON).damage;
	m.contributors = [7, 8];
	const killer = primeSwing(serverAvatar(7, 20));
	const helper = serverAvatar(8, 300);
	helper.rngState = 999;
	const state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [killer, helper],
		tick: 0,
	};
	const next = stepZone(
		state,
		[{ ...holdAt(7, killer.avatar), attack: true }, holdAt(8, helper.avatar)],
		16,
	);
	expect(next.zone.monsters.length).toBe(0);

	expect(next.avatars[0].progress.xp).toBe(xpForKill('chaser', TEST_ZONE_ID));
	expect(next.avatars[1].progress.xp).toBe(xpForKill('chaser', TEST_ZONE_ID));
	expect(next.avatars[0].inventory.length).toBe(1);
	expect(next.avatars[1].inventory.length).toBe(0);
	const helperDrops = (next.zone.drops ?? []).filter((d) => d.owner === 8);
	expect(helperDrops.length).toBe(1);

	const expected = rollDrop(
		999,
		next.avatars[1].progress.level,
		lootTableFor(TEST_ZONE_ID),
	);
	if (!expected.item) throw new Error('test loot table must always drop');
	expect(helperDrops[0].item).toEqual({ ...expected.item, id: 1 });
});

test('a non-contributor present at a shared kill receives nothing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = weaponById(DEFAULT_WEAPON).damage;
	const killer = primeSwing(serverAvatar(7, 20));
	const bystander = serverAvatar(8, 300);
	const state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [killer, bystander],
		tick: 0,
	};
	const next = stepZone(
		state,
		[
			{ ...holdAt(7, killer.avatar), attack: true },
			holdAt(8, bystander.avatar),
		],
		16,
	);
	expect(next.avatars[0].progress.xp).toBe(xpForKill('chaser', TEST_ZONE_ID));
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
});

function testItem(id = 1): Item {
	return {
		id,
		base: 'Rusty Sword',
		slot: 'weapon',
		rarity: 'rare',
		affixes: [{ stat: 'str', value: 3 }],
	};
}

test('an uncollected Drop fades once its ttl drains', () => {
	const owner = serverAvatar(7, 20);
	const drop: Drop = {
		id: 1,
		owner: 7,
		item: testItem(),
		x: 300,
		y,
		w: 9,
		h: 5,
		ttl: 0.005,
	};
	const zone: Zone = { ...zoneWith([]), drops: [drop], nextDropId: 2 };
	const next = stepZone(
		{ zone, avatars: [owner], tick: 0 },
		[holdAt(7, owner.avatar)],
		16,
	);
	expect(next.zone.drops ?? []).toEqual([]);
	expect(next.avatars[0].inventory.length).toBe(0);
});

test('snapshotFor streams a session only its OWN Drops (instanced/private)', () => {
	const a = serverAvatar(7, 20);
	const b = serverAvatar(8, 60);
	const box = { w: 9, h: 5, y, ttl: 5 };
	const mine: Drop = { id: 1, owner: 7, item: testItem(1), x: 20, ...box };
	const theirs: Drop = { id: 2, owner: 8, item: testItem(2), x: 60, ...box };
	const zone: Zone = { ...zoneWith([]), drops: [mine, theirs], nextDropId: 3 };
	const state: ZoneState = { zone, avatars: [a, b], tick: 0 };
	expect(snapshotFor(state, 7).drops.map((d) => d.owner)).toEqual([7]);
	expect(snapshotFor(state, 8).drops.map((d) => d.owner)).toEqual([8]);
});

test('an Avatar dying emits a radial death CombatEvent at the death position, before respawn', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = strikingCommitterAt20();
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);

	const death = next.events?.find(
		(ev) => ev.dir === 0 && ev.intensity === COMBAT.deathBurstIntensity,
	);
	expect(death?.kind).toBe('death');

	expect(death?.x).toBeGreaterThanOrEqual(20);
	expect(next.avatars[0].avatar.x).toBe(SPAWN.x);
});

test('stepZone reports the sessions that died this tick in deaths', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = strikingCommitterAt20();
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.deaths).toEqual([7]);
});

test('stepZone reports no deaths when every Avatar survives the tick', () => {
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.deaths).toEqual([]);
});

test('stepZone is pure and deterministic for identical state + intents', () => {
	const mk = () => {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.hp = weaponById(DEFAULT_WEAPON).damage;
		const av = primeSwing(serverAvatar(7, 20));
		return { zone: zoneWith([m]), avatars: [av], tick: 0 } as ZoneState;
	};
	const intent: AvatarIntent = {
		...holdAt(7, serverAvatar(7, 20).avatar),
		attack: true,
	};
	const input = mk();
	const before = structuredClone(input);
	const a = stepZone(input, [intent], 16);
	const b = stepZone(mk(), [intent], 16);
	expect(input).toEqual(before);
	expect(b.avatars[0].inventory[0]).toEqual(a.avatars[0].inventory[0]);
	expect(b.avatars[0].progress.xp).toBe(a.avatars[0].progress.xp);
});

test('removeAvatar drops a disconnected session from the Zone', () => {
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	expect(removeAvatar(state, 7).avatars.length).toBe(0);
	expect(removeAvatar(state, 99).avatars.length).toBe(1);
});

test('addAvatar spawns a Warrior at the safe point with its handle', () => {
	const spawned = addAvatar(createZoneState(zoneWith([])), 7, 'neo');
	expect(spawned.avatars.length).toBe(1);
	expect(spawned.avatars[0].sessionId).toBe(7);
	expect(spawned.avatars[0].handle).toBe('neo');
	expect(spawned.avatars[0].avatar.x).toBe(SPAWN.x);
});

test('clientStepAvatar predicts platformer movement and decays the hurt timer', () => {
	const a = { ...spawnAvatar(20, y), attackT: 0.3, hurtT: 0.3 };
	const predicted = clientStepAvatar(
		flatTerrain(),
		a,
		{ moveX: 1, jump: false },
		16,
	);
	expect(predicted.x).toBeGreaterThan(20);
	expect(predicted.hurtT).toBeLessThan(0.3);
	expect(predicted.attackT).toBe(0.3);
});

test('projectile damage emits one hit CombatEvent at the Avatar, dir = projectile travel, intensity = projectile damage', () => {
	const av = serverAvatar(7, 20);
	const pr = makeProjectile({
		x: 22,
		y: av.avatar.y + 2,
		vx: -36,
		damage: 7,
		life: 1,
	});
	const zone: Zone = { ...zoneWith([]), projectiles: [pr] };
	const state: ZoneState = { zone, avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(av.avatar.hp - 7);
	expect(next.events?.length).toBe(1);
	const ev = next.events?.[0];
	expect(ev?.kind).toBe('hit');
	expect(ev?.dir).toBe(-1);
	expect(ev?.intensity).toBe(7);
	expect(ev?.kind === 'hit' && ev.source).toBeUndefined();
});

test('an i-framed Avatar struck by a projectile emits no hit event', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hurtT = 0.5;
	const pr = makeProjectile({
		x: 22,
		y: av.avatar.y + 2,
		vx: -36,
		damage: 7,
		life: 1,
	});
	const zone: Zone = { ...zoneWith([]), projectiles: [pr] };
	const state: ZoneState = { zone, avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.events ?? []).toEqual([]);
});

test('a ranged poker telegraphs through stepZone: it commits a swing and fires only on the active frame', () => {
	const m = spawnMonster('shooter', 2, 50, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(state.zone.monsters[0].attackT).toBeGreaterThan(0);
	expect(state.zone.projectiles.length).toBe(0);
	const snap = snapshotFor(state, 7);
	expect(snap.monsters[0].action.move).toBe('basic');
	let fired = state.zone.projectiles;
	for (let i = 0; i < 12 && fired.length === 0; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		fired = state.zone.projectiles;
	}
	expect(fired.length).toBe(1);
	expect(fired[0].vx).toBeLessThan(0);
});

test('a crowded shooter repositions without firing inside its minimum range', () => {
	const m = spawnMonster('shooter', 2, 50, y);
	m.onGround = true;
	const av = serverAvatar(7, 50);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	for (let i = 0; i < 150; i++) {
		const mon = state.zone.monsters[0];
		const held = holdAt(7, state.avatars[0].avatar);
		state = stepZone(state, [{ ...held, x: mon.x, vx: 0 }], 16);
		expect(state.zone.projectiles.length).toBe(0);
	}
	expect(state.zone.nextProjectileId).toBe(1);
	expect(state.zone.monsters[0].x).toBeGreaterThan(50);
});

test('the shooter releases every shot from its comfort band, never closer than keepDist', () => {
	const { keepDist } = ARCHETYPES.shooter.ranged;
	const m = spawnMonster('shooter', 2, 30, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const releaseGaps: number[] = [];
	let lastId = state.zone.nextProjectileId;
	for (let i = 0; i < 400; i++) {
		const held = holdAt(7, state.avatars[0].avatar);
		state = stepZone(state, [{ ...held, x: 20, vx: 0 }], 16);
		if (state.zone.nextProjectileId > lastId) {
			lastId = state.zone.nextProjectileId;
			releaseGaps.push(Math.abs(state.zone.monsters[0].x - 20));
		}
	}
	expect(releaseGaps.length).toBeGreaterThan(0);
	for (const gap of releaseGaps) expect(gap).toBeGreaterThanOrEqual(keepDist);
});

test('an unaggroed Monster patrols: it turns at the world edge instead of walking off', () => {
	const m = spawnMonster('chaser', 2, 220, y);
	m.onGround = true;
	m.facing = 1;
	const av = serverAvatar(7, 10);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	let maxX = m.x;
	for (let i = 0; i < 300; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		maxX = Math.max(maxX, state.zone.monsters[0].x);
	}
	expect(maxX).toBeLessThanOrEqual(240 - BOX.w);
	expect(state.zone.monsters[0].x).toBeLessThan(220);
	expect(state.zone.monsters[0].facing).toBe(-1);
});

test("the Brain's ai memory stays server-private: never in snapshots, never on the wire", () => {
	const m = spawnMonster('shooter', 2, 50, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [holdAt(7, av.avatar)], 16);

	expect(state.zone.monsters[0].ai).toEqual({ state: 'attack' });

	const snap = snapshotFor(state, 7);
	expect(Object.keys(snap.monsters[0])).not.toContain('ai');
	const decoded = decodeServerMessage(encodeServerMessage(snap));
	expect(JSON.stringify(decoded)).not.toContain('"ai"');
});

test('an unguarded heavy projectile Staggers the Avatar on a Poise break, like a melee hit', () => {
	const av = serverAvatar(7, 20);
	const pr = makeProjectile({
		x: 22,
		y: av.avatar.y + 2,
		vx: 36,
		damage: 7,
		poiseDamage: 20,
		knockback: 40,
		life: 1,
	});
	const state: ZoneState = {
		zone: { ...zoneWith([]), projectiles: [pr] },
		avatars: [av],
		tick: 0,
	};
	const next = stepZone(state, [holdAt(7, av.avatar)], 16).avatars[0].avatar;
	expect(next.hp).toBe(av.avatar.hp - 7);
	expect(next.stunT ?? 0).toBeGreaterThan(0);
	expect(next.ivx ?? 0).toBeGreaterThan(0);
});

test('a frontal Guard chips a projectile, drains Poise, and consumes the shot', () => {
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = 1;
	av.avatar.guardT = 0.5;
	const pr = makeProjectile({
		x: 22,
		y: av.avatar.y + 2,
		vx: -36,
		damage: 8,
		life: 1,
	});
	const state: ZoneState = {
		zone: { ...zoneWith([]), projectiles: [pr] },
		avatars: [av],
		tick: 0,
	};
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const a = next.avatars[0].avatar;
	expect(a.hp).toBe(av.avatar.hp - Math.ceil(8 * COMBAT.guard.blockChip));
	expect(a.poise ?? COMBAT.poise.max).toBeLessThan(COMBAT.poise.max);
	expect(next.zone.projectiles.length).toBe(0);
});

test('an active melee swing swats a hostile shot', () => {
	const av = primeSwing(serverAvatar(7, 20));
	av.avatar.facing = 1;
	const pr = makeProjectile({
		x: 27,
		y: av.avatar.y + 2,
		vx: -36,
		damage: 7,
		life: 1,
	});
	const state: ZoneState = {
		zone: { ...zoneWith([]), projectiles: [pr] },
		avatars: [av],
		tick: 0,
	};
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), attack: true }], 16);
	expect(next.zone.projectiles.length).toBe(0);
	expect(next.avatars[0].avatar.hp).toBe(av.avatar.hp);

	const clink = next.events?.find((e) => e.kind === 'swat');
	expect(clink?.intensity).toBe(7);
	expect(clink?.targetId).toBe(pr.id);
	expect(clink).not.toHaveProperty('source');
});

test('snapshotFor carries the zone state + the recipient private fields', () => {
	const m = spawnMonster('shooter', 2, 50, y);
	const a = serverAvatar(7, 20, 'morpheus');
	a.progress = { level: 2, xp: 5, gold: 9 };
	const b = serverAvatar(8, 60, 'trinity');
	const state: ZoneState = { zone: zoneWith([m]), avatars: [a, b], tick: 3 };
	const snap = snapshotFor(state, 7);
	expect(snap.t).toBe('snapshot');
	expect(snap.tick).toBe(3);
	expect(snap.avatars.length).toBe(2);
	expect(snap.avatars.find((s) => s.sessionId === 8)?.handle).toBe('trinity');
	expect(snap.monsters.length).toBe(1);
	expect(snap.progress).toEqual({ level: 2, xp: 5, gold: 9 });
	expect(snap.zoneId).toBe(TEST_ZONE_ID);
});

test('snapshotFor suppresses hit CombatEvents back to their originator and strips source', () => {
	const a = serverAvatar(7, 20, 'morpheus');
	const b = serverAvatar(8, 60, 'trinity');
	const state: ZoneState = {
		zone: zoneWith([]),
		avatars: [a, b],
		tick: 3,
		events: [
			{ kind: 'hit', targetId: 1, x: 1, y: 1, intensity: 8, dir: 1, source: 7 },
			{
				kind: 'hit',
				targetId: 2,
				x: 2,
				y: 2,
				intensity: 5,
				dir: -1,
				source: 8,
			},
		],
	};

	const forA = snapshotFor(state, 7);
	expect(forA.events).toEqual([
		{ kind: 'hit', targetId: 2, x: 2, y: 2, intensity: 5, dir: -1 },
	]);
	expect(forA.events[0]).not.toHaveProperty('source');
	const forB = snapshotFor(state, 8);
	expect(forB.events).toEqual([
		{ kind: 'hit', targetId: 1, x: 1, y: 1, intensity: 8, dir: 1 },
	]);
	expect(forB.events[0]).not.toHaveProperty('source');
});

function attackRight(av: ServerAvatar): AvatarIntent {
	av.avatar.facing = 1;
	av.avatar.hurtT = 5;
	return { ...holdAt(av.sessionId, av.avatar), attack: true };
}

test('a single chip hit deals HP + Poise damage but does NOT Stagger a full-Poise Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	const mon = next.zone.monsters[0];
	expect(mon.hp).toBe(ARCHETYPES.chaser.hp - COMBAT.meleeDamage);
	expect(mon.poise).toBe(COMBAT.poise.max - COMBAT.poiseDamage);
	expect(mon.stunT ?? 0).toBe(0);
	expect(mon.ivx ?? 0).toBe(0);
	expect(next.events?.some((e) => e.kind === 'break')).toBe(false);
	expect(next.events?.some((e) => e.kind === 'hit')).toBe(true);
});

test('wind-up super-armor absorbs a Poise break without interrupting the committed swing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	m.poise = 1;
	m.attackT = SWING_TOTAL;
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	const mon = next.zone.monsters[0];
	expect(mon.hp).toBeLessThan(100);
	expect(mon.poise).toBe(0);
	expect(mon.stunT ?? 0).toBe(0);
	expect(swingPhase(mon.attackT)).toBe('windup');
});

test('a Poise break Staggers: Hitstun + a Knockback impulse + a break CombatEvent', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.poise = 1;
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	const mon = next.zone.monsters[0];
	expect(mon.hp).toBe(ARCHETYPES.chaser.hp - COMBAT.meleeDamage);
	expect(mon.stunT ?? 0).toBeGreaterThan(0);
	expect(mon.ivx ?? 0).toBeGreaterThan(0);
	const brk = next.events?.find((e) => e.kind === 'break');
	expect(brk?.dir).toBe(1);
	expect(next.events?.some((e) => e.kind === 'hit')).toBe(false);
});

test('Knockback is scaled by Mass — a lighter body is thrown farther by the same break', () => {
	function breakIvx(mass: number): number {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.poise = 1;
		m.mass = mass;
		const av = primeSwing(serverAvatar(7, 20));
		const next = stepZone(
			{ zone: zoneWith([m]), avatars: [av], tick: 0 },
			[attackRight(av)],
			16,
		);
		return next.zone.monsters[0].ivx ?? 0;
	}
	expect(breakIvx(1)).toBeGreaterThan(breakIvx(4));
});

test('Hitstun locks control but not physics: a staggered Monster flies under Knockback, not chasing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.poise = 1;
	m.onGround = true;
	const av = primeSwing(serverAvatar(7, 20));
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [attackRight(av)], 16);
	expect(state.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);
	const brokenX = state.zone.monsters[0].x;

	const a = state.avatars[0].avatar;
	for (let i = 0; i < 5; i++) state = stepZone(state, [holdAt(7, a)], 16);
	expect(state.zone.monsters[0].x).toBeGreaterThan(brokenX);
	expect(state.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);
});

test('a staggered Monster remains hittable by a fresh swing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	m.poise = 1;
	const av = primeSwing(serverAvatar(7, 20));
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [attackRight(av)], 16);
	expect(state.zone.monsters[0].hp).toBe(100 - COMBAT.meleeDamage);
	expect(state.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);

	state.avatars[0].avatar.swingHits = [];
	state.avatars[0].avatar.attackT = MID_ACTIVE;
	state = stepZone(state, [attackRight(state.avatars[0])], 16);
	expect(state.zone.monsters[0].hp).toBe(100 - 2 * COMBAT.meleeDamage);
});

test('a Staggered Monster surfaces the staggered action-flag in the snapshot', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.poise = 1;
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	const snap = snapshotFor(next, 7);
	expect(snap.monsters[0].action.flags & ACTION_FLAG.staggered).toBe(
		ACTION_FLAG.staggered,
	);
});

test('a default chaser Poise-breaks strictly before it dies (the break is observable)', () => {
	const hitsToBreak = Math.ceil(COMBAT.poise.max / COMBAT.poiseDamage);
	const hitsToKill = Math.ceil(ARCHETYPES.chaser.hp / COMBAT.meleeDamage);
	expect(hitsToBreak).toBeLessThan(hitsToKill);
});

test('sustained real swings Stagger a chaser while it is still alive (regen is gated)', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	let state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [serverAvatar(7, 20)],
		tick: 0,
	};
	let staggeredAlive = false;
	for (let i = 0; i < 120 && state.zone.monsters.length > 0; i++) {
		const mon = state.zone.monsters[0];
		const intent: AvatarIntent = {
			sessionId: 7,
			x: mon.x - BOX.w,
			y,
			vx: 0,
			vy: 0,
			facing: 1,
			onGround: true,
			attack: true,
		};
		state = stepZone(state, [intent], 16);
		const after = state.zone.monsters[0];
		if (after && (after.stunT ?? 0) > 0 && after.hp > 0) staggeredAlive = true;
	}
	expect(staggeredAlive).toBe(true);
	expect(state.zone.monsters.length).toBe(0);
});

test('Poise regenerates once pressure stops (a spaced poke does not accumulate to a break)', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 1000;
	let state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [primeSwing(serverAvatar(7, 20))],
		tick: 0,
	};
	state = stepZone(state, [attackRight(state.avatars[0])], 16);
	const chipped = state.zone.monsters[0].poise ?? 0;
	expect(chipped).toBeLessThan(COMBAT.poise.max);
	expect(state.zone.monsters[0].stunT ?? 0).toBe(0);
	const a = state.avatars[0].avatar;
	for (let i = 0; i < 120; i++) state = stepZone(state, [holdAt(7, a)], 16);
	expect(state.zone.monsters[0].poise).toBe(COMBAT.poise.max);
});

test('a landed swing uses equipped-weapon damage and shared poise damage', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	const av = primeSwing(serverAvatar(7, 20));
	av.avatar.weapon = DEFAULT_WEAPON;
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	expect(next.zone.monsters[0].hp).toBe(
		100 - weaponById(DEFAULT_WEAPON).damage,
	);
	expect(next.zone.monsters[0].poise).toBe(
		COMBAT.poise.max - COMBAT.poiseDamage,
	);
});

test('every weapon index swings the one shared moveset — timing from COMBAT.swing', () => {
	for (const weapon of [DEFAULT_WEAPON, 999]) {
		const av = primeSwing(serverAvatar(7, 20));
		av.avatar.weapon = weapon;
		const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
		const snap = snapshotFor(state, 7);
		expect(snap.avatars[0].action.move).toBe('basic');
		expect(snap.avatars[0].action.phase).toBe('active');
	}
});

test('a Poise break throws the body along the swing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	m.poise = 1;
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	expect(next.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);
	expect(next.zone.monsters[0].ivx ?? 0).toBeGreaterThan(0);
});
