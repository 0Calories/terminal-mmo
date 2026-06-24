import { expect, test } from 'bun:test';
import type {
	AvatarIntent,
	Entity,
	ServerAvatar,
	Zone,
	ZoneState,
} from '../src';
import {
	ACTION_FLAG,
	addAvatar,
	BOX,
	COMBAT,
	clientStepAvatar,
	createZoneState,
	DEFAULT_COSMETICS,
	entityTint,
	GROUND_TOP,
	MONSTER,
	removeAvatar,
	rollItem,
	SPAWN,
	SWING_TOTAL,
	snapshotFor,
	spawnAvatar,
	spawnMonster,
	stepZone,
	swingPhase,
	WEAPONS,
	weaponById,
	weaponSwingTotal,
	XP_PER_KILL,
} from '../src';
import { flatTerrain } from './helpers';

const y = GROUND_TOP - BOX.h;

function serverAvatar(
	sessionId: number,
	x: number,
	handle = 'hero',
): ServerAvatar {
	return {
		sessionId,
		handle,
		cosmetics: DEFAULT_COSMETICS,
		avatar: { ...spawnAvatar(x, y), id: sessionId },
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [],
		log: [],
		nextId: 1,
		rngState: 1,
	};
}

function zoneWith(monsters: Entity[]): Zone {
	return {
		id: 'field-01',
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

// The basic swing is now phased (ADR 0017 §1): its hitbox is live only during the
// active window, so a hit no longer lands on the tick `attack` is pressed (it starts
// a wind-up). The outcome tests below care about a connect's *consequences* (damage,
// blood, XP, loot, contributors), not the wind-up timing — which is covered by the
// dedicated phase-timing test further down + combat.test — so they prime the swing
// into its active phase and land the hit in a single tick.
const MID_ACTIVE = SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
function primeSwing(av: ServerAvatar): ServerAvatar {
	av.avatar.attackT = MID_ACTIVE;
	return av;
}

// hold position, no attack, reporting the avatar's current spot back to the server
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

test('an Avatar attack intent damages an adjacent Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = primeSwing(serverAvatar(7, 20));
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters[0].hp).toBe(MONSTER.chaserHp - 8);
	expect(next.tick).toBe(1);
});

test('stepZone keeps the melee hitbox live ONLY during the swing active phase', () => {
	// Drive a real swing tick by tick (no priming): the Monster takes NO damage
	// through wind-up, then exactly one hit when the swing enters its active phase
	// (ADR 0017 §1) — the keystone behavior of the phase machine end to end.
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100; // survives the hit so we can read the single connect
	const av = serverAvatar(7, 20);
	av.avatar.facing = 1;
	av.avatar.hurtT = 5; // i-framed, so the chaser's contact can't end the run early
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
	expect(sawWindupNoDamage).toBe(true); // no damage while winding up
	expect(hitPhase).toBe('active'); // the connect lands in the active phase
});

test('a skill intent damages a Monster and the server folds its cooldown + log', () => {
	// Detailed skill gating (level/cooldown/override) is covered at the
	// resolveCombat seam (combat.test.ts); here we only confirm a skill intent
	// flows through a full stepZone tick and the server folds the result.
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = serverAvatar(7, 20); // level 1; Power Strike unlocks at L1
	av.class = 'warrior';
	av.skillCooldowns = {};
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), skill: 1 };
	const next = stepZone(state, [intent], 16);
	// Power Strike (20 dmg) hit, not the 8-dmg basic swing.
	expect(next.zone.monsters[0].hp).toBe(MONSTER.chaserHp - 20);
	const me = next.avatars[0];
	expect(me.skillCooldowns?.['power-strike']).toBeGreaterThan(0);
	expect(me.log.at(-1)).toBe('Power Strike!');
});

test('a Monster hit emits one blood Effect at the Monster, intensity scaled by damage, dir = attacker facing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = primeSwing(serverAvatar(7, 20));
	av.avatar.facing = 1; // swinging to the right, into the Monster
	av.avatar.hurtT = 1; // i-framed, so the chasing Monster's contact draws no blood
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.effects?.length).toBe(1);
	const fx = next.effects?.[0];
	expect(fx?.kind).toBe('blood');
	expect(fx?.dir).toBe(1);
	expect(fx?.intensity).toBe(8); // the melee damage dealt
	// at the Monster's position (within its footprint box)
	expect(fx?.x).toBeGreaterThanOrEqual(m.x);
	expect(fx?.x).toBeLessThanOrEqual(m.x + BOX.w);
	expect(fx?.y).toBeGreaterThanOrEqual(m.y);
	expect(fx?.y).toBeLessThanOrEqual(m.y + BOX.h);
});

test('no Effect is emitted when the hit lands on an i-framed Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hurtT = 0.5; // still invulnerable
	const av = serverAvatar(7, 20);
	av.avatar.hurtT = 1; // i-framed, so the chasing Monster's contact draws no blood
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters[0].hp).toBe(MONSTER.chaserHp); // no damage
	expect(next.effects ?? []).toEqual([]);
});

test('a tick with no combat emits no Effects', () => {
	const m = spawnMonster('chaser', 2, 80, y); // far away, no hit
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.effects ?? []).toEqual([]);
});

test('the Avatar landing the killing blow earns the XP and the loot roll', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4; // one swing kills
	const av = primeSwing(serverAvatar(7, 20));
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters.length).toBe(0);
	const me = next.avatars[0];
	expect(me.progress.xp).toBe(XP_PER_KILL);
	expect(me.inventory.length).toBe(1);
	expect(me.inventory[0].id).toBe(1); // from the killer's own nextId
});

test('a Monster dying emits a radial, high-intensity gore Effect at the Monster, tinted by its body', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4; // one swing kills
	const av = primeSwing(serverAvatar(7, 20));
	av.avatar.facing = 1;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters.length).toBe(0); // dead
	// the kill burst: radial (dir 0), intensity above the chip-hit damage
	const death = next.effects?.find((fx) => fx.dir === 0);
	expect(death?.kind).toBe('gore');
	expect(death?.tint).toEqual(entityTint(m)); // chaser body colour
	expect(death?.intensity).toBe(COMBAT.deathBurstIntensity);
	expect(death?.x).toBeGreaterThanOrEqual(m.x);
	expect(death?.x).toBeLessThanOrEqual(m.x + BOX.w);
	// death burst is bigger than the chip hit it also emitted this tick
	const chip = next.effects?.find((fx) => fx.dir !== 0);
	expect(death?.intensity).toBeGreaterThan(chip?.intensity ?? 0);
});

test('a living Monster touching an Avatar deals server-owned contact damage', () => {
	const m = spawnMonster('chaser', 2, 20, y); // stacked on the avatar
	m.onGround = true;
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(before - MONSTER.contactDamage);
	expect(next.avatars[0].avatar.hurtT).toBeGreaterThan(0);
});

test('contact damage emits one blood Effect at the Avatar, dir away from the Monster, intensity = contact damage', () => {
	const m = spawnMonster('chaser', 2, 18, y); // touching, just left of the Avatar
	m.onGround = true;
	const av = serverAvatar(7, 20); // Avatar to the Monster's right
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.effects?.length).toBe(1);
	const fx = next.effects?.[0];
	expect(fx?.kind).toBe('blood');
	expect(fx?.dir).toBe(1); // knocked away from the Monster (to the right)
	expect(fx?.intensity).toBe(MONSTER.contactDamage);
	// at the Avatar's footprint box
	expect(fx?.x).toBeGreaterThanOrEqual(av.avatar.x);
	expect(fx?.x).toBeLessThanOrEqual(av.avatar.x + BOX.w);
	expect(fx?.y).toBeGreaterThanOrEqual(av.avatar.y);
	expect(fx?.y).toBeLessThanOrEqual(av.avatar.y + BOX.h);
	expect(fx?.source).toBeUndefined(); // server-sourced, never suppressed to the victim
});

test('a Monster targets and chases the nearest Avatar', () => {
	const m = spawnMonster('chaser', 2, 50, y);
	m.onGround = true;
	const near = serverAvatar(7, 45); // 5 away
	const far = serverAvatar(8, 10); // 40 away
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
	expect(next.zone.monsters[0].x).toBeLessThan(50); // moved toward x=45, not x=10
});

test('only the Avatar landing the kill is credited when two are present', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4;
	const attacker = primeSwing(serverAvatar(7, 20)); // adjacent, swings
	const bystander = serverAvatar(8, 200); // far away, idle
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
	expect(next.avatars[0].progress.xp).toBe(XP_PER_KILL);
	expect(next.avatars[0].inventory.length).toBe(1);
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
});

test('a landing hit records the attacker as a contributor on the Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y); // full HP, survives one swing
	const av = primeSwing(serverAvatar(7, 20));
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), attack: true }], 16);
	expect(next.zone.monsters[0].hp).toBeLessThan(MONSTER.chaserHp); // took damage
	expect(next.zone.monsters[0].contributors).toEqual([7]);
});

test('on death every recorded contributor earns shared XP and its own loot roll', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4; // the next swing kills it
	m.contributors = [7, 8]; // both damaged it on earlier ticks
	const killer = primeSwing(serverAvatar(7, 20)); // adjacent, lands the killing blow
	const helper = serverAvatar(8, 300); // damaged it earlier, now far away
	helper.rngState = 999; // a distinct loot seed, to prove instancing
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
	// Shared, not split: each contributor gets the FULL kill XP.
	expect(next.avatars[0].progress.xp).toBe(XP_PER_KILL);
	expect(next.avatars[1].progress.xp).toBe(XP_PER_KILL);
	// Each rolls its OWN private loot, seeded per-Player (instanced).
	expect(next.avatars[0].inventory.length).toBe(1);
	expect(next.avatars[1].inventory.length).toBe(1);
	const expected = rollItem(999, next.avatars[1].progress.level);
	expect(next.avatars[1].inventory[0]).toEqual({ ...expected.item, id: 1 });
});

test('a non-contributor present at a shared kill receives nothing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4;
	const killer = primeSwing(serverAvatar(7, 20));
	const bystander = serverAvatar(8, 300); // never damaged it
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
	expect(next.avatars[0].progress.xp).toBe(XP_PER_KILL);
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
});

test('an Avatar reduced to 0 HP respawns at the safe point at full HP', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = spawnMonster('chaser', 2, 20, y); // contact will finish it
	m.onGround = true;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	const a = next.avatars[0].avatar;
	expect(a.hp).toBe(a.maxHp);
	expect(a.x).toBe(SPAWN.x);
	expect(a.y).toBe(SPAWN.y);
});

test('an Avatar dying emits a radial gore Effect at the death position, before respawn', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = spawnMonster('chaser', 2, 20, y); // contact finishes the Avatar
	m.onGround = true;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	// the killing contact also emits a hurt burst; the death burst is the radial,
	// death-intensity one.
	const death = next.effects?.find(
		(fx) => fx.dir === 0 && fx.intensity === COMBAT.deathBurstIntensity,
	);
	expect(death?.kind).toBe('gore');
	// at the death spot (~x 20), NOT the respawn point (SPAWN.x = 10)
	expect(death?.x).toBeGreaterThanOrEqual(20);
	expect(next.avatars[0].avatar.x).toBe(SPAWN.x); // respawn still happened
});

test('stepZone reports the sessions that died this tick in deaths', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = spawnMonster('chaser', 2, 20, y); // contact finishes the Avatar
	m.onGround = true;
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

test('stepZone is deterministic for identical state + intents', () => {
	const mk = () => {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.hp = 4;
		const av = primeSwing(serverAvatar(7, 20));
		return { zone: zoneWith([m]), avatars: [av], tick: 0 } as ZoneState;
	};
	const intent: AvatarIntent = {
		...holdAt(7, serverAvatar(7, 20).avatar),
		attack: true,
	};
	const a = stepZone(mk(), [intent], 16);
	const b = stepZone(mk(), [intent], 16);
	expect(b.avatars[0].inventory[0]).toEqual(a.avatars[0].inventory[0]);
	expect(b.avatars[0].progress.xp).toBe(a.avatars[0].progress.xp);
});

test('removeAvatar drops a disconnected session from the Zone', () => {
	const av = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	expect(removeAvatar(state, 7).avatars.length).toBe(0);
	expect(removeAvatar(state, 99).avatars.length).toBe(1); // unknown id is a no-op
});

test('addAvatar spawns a Warrior at the safe point with its handle', () => {
	const spawned = addAvatar(createZoneState(zoneWith([])), 7, 'neo');
	expect(spawned.avatars.length).toBe(1);
	expect(spawned.avatars[0].sessionId).toBe(7);
	expect(spawned.avatars[0].handle).toBe('neo');
	expect(spawned.avatars[0].avatar.x).toBe(SPAWN.x);
});

test('clientStepAvatar predicts platformer movement and decays the hurt timer', () => {
	// attackT decay now lives in resolveCombat (the shared combat gate the frame
	// loop runs); clientStepAvatar only advances physics and decays hurtT.
	const a = { ...spawnAvatar(20, y), attackT: 0.3, hurtT: 0.3 };
	const predicted = clientStepAvatar(
		flatTerrain(),
		a,
		{ moveX: 1, jump: false },
		16,
	);
	expect(predicted.x).toBeGreaterThan(20); // ran right
	expect(predicted.hurtT).toBeLessThan(0.3); // hurt timer ticked down locally
	expect(predicted.attackT).toBe(0.3); // attackT is no longer decayed here
});

test('projectile damage emits one blood Effect at the Avatar, dir = projectile travel, intensity = projectile damage', () => {
	const av = serverAvatar(7, 20);
	const pr = {
		id: 1,
		x: 22, // overlapping the Avatar's box
		y: av.avatar.y + 2,
		vx: -36, // travelling left: away from a shooter on the right
		vy: 0,
		life: 1,
		damage: 7,
		ownerId: 999,
	};
	const zone: Zone = { ...zoneWith([]), projectiles: [pr] };
	const state: ZoneState = { zone, avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(av.avatar.hp - 7); // took the hit
	expect(next.effects?.length).toBe(1);
	const fx = next.effects?.[0];
	expect(fx?.kind).toBe('blood');
	expect(fx?.dir).toBe(-1); // knocked along the projectile's travel
	expect(fx?.intensity).toBe(7);
	expect(fx?.source).toBeUndefined(); // server-sourced
});

test('an i-framed Avatar struck by a projectile bleeds no blood', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hurtT = 0.5; // still invulnerable
	const pr = {
		id: 1,
		x: 22,
		y: av.avatar.y + 2,
		vx: -36,
		vy: 0,
		life: 1,
		damage: 7,
		ownerId: 999,
	};
	const zone: Zone = { ...zoneWith([]), projectiles: [pr] };
	const state: ZoneState = { zone, avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.effects ?? []).toEqual([]);
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
	expect(snap.avatars.length).toBe(2); // sees both Avatars
	expect(snap.avatars.find((s) => s.sessionId === 8)?.handle).toBe('trinity');
	expect(snap.monsters.length).toBe(1);
	expect(snap.progress).toEqual({ level: 2, xp: 5, gold: 9 }); // recipient's own
	expect(snap.zoneId).toBe('field-01'); // the zone the recipient is currently in
});

test('a Monster hit attributes the Effect to the attacking session via source', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	const av = primeSwing(serverAvatar(7, 20));
	av.avatar.facing = 1;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), attack: true }], 16);
	expect(next.effects?.[0]?.source).toBe(7);
});

test('snapshotFor suppresses Effects back to their originator and strips source', () => {
	const a = serverAvatar(7, 20, 'morpheus');
	const b = serverAvatar(8, 60, 'trinity');
	const state: ZoneState = {
		zone: zoneWith([]),
		avatars: [a, b],
		tick: 3,
		effects: [
			{ kind: 'blood', x: 1, y: 1, intensity: 8, dir: 1, source: 7 },
			{ kind: 'blood', x: 2, y: 2, intensity: 5, dir: -1, source: 8 },
		],
	};
	// 7 caused the first burst → it is suppressed back to 7; 7 still sees 8's.
	const forA = snapshotFor(state, 7);
	expect(forA.effects).toEqual([
		{ kind: 'blood', x: 2, y: 2, intensity: 5, dir: -1 },
	]);
	// 8 sees 7's burst (source stripped), not its own.
	const forB = snapshotFor(state, 8);
	expect(forB.effects).toEqual([
		{ kind: 'blood', x: 1, y: 1, intensity: 8, dir: 1 },
	]);
});

test('snapshotFor carries an empty Effects list when none were emitted', () => {
	const a = serverAvatar(7, 20);
	const state: ZoneState = { zone: zoneWith([]), avatars: [a], tick: 0 };
	expect(snapshotFor(state, 7).effects).toEqual([]);
});

// --- Poise / Hitstun / Knockback hit-reaction (ADR 0017 §2/§3) ---------------

// A primed swing that lands an attack this tick on an adjacent Monster to its right.
function attackRight(av: ServerAvatar): AvatarIntent {
	av.avatar.facing = 1;
	av.avatar.hurtT = 5; // ignore any contact damage so we read only the melee outcome
	return { ...holdAt(av.sessionId, av.avatar), attack: true };
}

test('a single chip hit deals HP + Poise damage but does NOT Stagger a full-Poise Monster', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y); // full default Poise
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	const mon = next.zone.monsters[0];
	expect(mon.hp).toBe(MONSTER.chaserHp - COMBAT.meleeDamage); // HP damage always lands
	expect(mon.poise).toBe(COMBAT.poise.max - COMBAT.poiseDamage); // Poise chipped, not broken
	expect(mon.stunT ?? 0).toBe(0); // not staggered
	expect(mon.ivx ?? 0).toBe(0); // no Knockback
	expect(next.effects?.some((e) => e.kind === 'impact')).toBe(false);
	expect(next.effects?.some((e) => e.kind === 'blood')).toBe(true);
});

test('a Poise break Staggers: Hitstun + a Knockback impulse + an impact Effect', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.poise = 1; // well below the break threshold, so the hit breaks even after this tick's Poise regen
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	const mon = next.zone.monsters[0];
	expect(mon.hp).toBe(MONSTER.chaserHp - COMBAT.meleeDamage);
	expect(mon.stunT ?? 0).toBeGreaterThan(0); // Hitstun: control locked
	expect(mon.ivx ?? 0).toBeGreaterThan(0); // knocked back along the attacker's facing (+x)
	const impact = next.effects?.find((e) => e.kind === 'impact');
	expect(impact?.dir).toBe(1);
	expect(next.effects?.some((e) => e.kind === 'blood')).toBe(false); // break, not chip
});

test('Knockback is scaled by Mass — a lighter body is thrown farther by the same break', () => {
	function breakIvx(mass: number): number {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.poise = 1; // well below the break threshold, so the hit breaks even after this tick's Poise regen
		m.mass = mass;
		const av = primeSwing(serverAvatar(7, 20));
		const next = stepZone(
			{ zone: zoneWith([m]), avatars: [av], tick: 0 },
			[attackRight(av)],
			16,
		);
		return next.zone.monsters[0].ivx ?? 0;
	}
	expect(breakIvx(1)).toBeGreaterThan(breakIvx(4)); // light rockets, heavy barely nudges
});

test('Hitstun locks control but not physics: a staggered Monster flies under Knockback, not chasing', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y); // to the RIGHT of the attacker
	m.poise = 1; // well below the break threshold, so the hit breaks even after this tick's Poise regen
	m.onGround = true;
	const av = primeSwing(serverAvatar(7, 20)); // attacker on the LEFT, swinging right
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [attackRight(av)], 16); // break it
	expect(state.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);
	const brokenX = state.zone.monsters[0].x;
	// Hold still: a chaser's AI would home LEFT toward the attacker, but Hitstun
	// suppresses it — the body drifts RIGHT under the Knockback shove instead.
	const a = state.avatars[0].avatar;
	for (let i = 0; i < 5; i++) state = stepZone(state, [holdAt(7, a)], 16);
	expect(state.zone.monsters[0].x).toBeGreaterThan(brokenX);
	expect(state.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0); // still inside the stun window
});

test('automatic post-hit i-frames are gone: a staggered Monster takes a second hit', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100; // survives both hits so we can read the cumulative damage
	m.poise = 1; // well below the break threshold, so the hit breaks even after this tick's Poise regen
	const av = primeSwing(serverAvatar(7, 20));
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [attackRight(av)], 16);
	expect(state.zone.monsters[0].hp).toBe(100 - COMBAT.meleeDamage);
	expect(state.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);
	// Old code stamped a 0.6s i-frame here, blocking everything. Land the NEXT swing
	// (a fresh swing clears the per-swing registry) while the Monster is still
	// staggered: with i-frames removed, it must take damage again.
	state.avatars[0].avatar.swingHits = [];
	state.avatars[0].avatar.attackT = MID_ACTIVE;
	state = stepZone(state, [attackRight(state.avatars[0])], 16);
	expect(state.zone.monsters[0].hp).toBe(100 - 2 * COMBAT.meleeDamage);
});

test('a Staggered Monster surfaces the staggered action-flag in the snapshot', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.poise = 1; // well below the break threshold, so the hit breaks even after this tick's Poise regen
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
	// The tuning guard behind the demo: if a chaser broke only on the same hit that
	// killed it, the Stagger would never be seen. Pure accumulation (regen is gated
	// under a flurry), so hit counts come straight from the constants.
	const hitsToBreak = Math.ceil(COMBAT.poise.max / COMBAT.poiseDamage);
	const hitsToKill = Math.ceil(MONSTER.chaserHp / COMBAT.meleeDamage);
	expect(hitsToBreak).toBeLessThan(hitsToKill);
});

test('sustained real swings Stagger a chaser while it is still alive (regen is gated)', () => {
	// Drive genuine swings (windup→active→recovery) tick by tick, keeping the Avatar
	// in melee range as the Monster is knocked back. The regen delay must hold the
	// pool down across swings so a break actually lands before the kill — an always-on
	// regen would refill it between swings and this would never observe a Stagger.
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	let state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [serverAvatar(7, 20)],
		tick: 0,
	};
	let staggeredAlive = false;
	for (let i = 0; i < 120 && state.zone.monsters.length > 0; i++) {
		const mon = state.zone.monsters[0];
		// Report the Avatar just to the Monster's left, facing into it, swinging.
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
	expect(staggeredAlive).toBe(true); // a Stagger was seen on a living chaser
	expect(state.zone.monsters.length).toBe(0); // and the flurry eventually killed it
});

test('Poise regenerates once pressure stops (a spaced poke does not accumulate to a break)', () => {
	// One hit chips the pool; then with no further hits the regen-delay drains and the
	// pool climbs back to full — so the SAME single chip never compounds into a break.
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 1000; // survive indefinitely
	let state: ZoneState = {
		zone: zoneWith([m]),
		avatars: [primeSwing(serverAvatar(7, 20))],
		tick: 0,
	};
	state = stepZone(state, [attackRight(state.avatars[0])], 16);
	const chipped = state.zone.monsters[0].poise ?? 0;
	expect(chipped).toBeLessThan(COMBAT.poise.max); // it was chipped
	expect(state.zone.monsters[0].stunT ?? 0).toBe(0); // not staggered by one chip
	// Now idle long enough for regen to resume and refill the pool.
	const a = state.avatars[0].avatar;
	for (let i = 0; i < 120; i++) state = stepZone(state, [holdAt(7, a)], 16);
	expect(state.zone.monsters[0].poise).toBe(COMBAT.poise.max); // fully recovered
});

// --- Weapon stat block feeds combat (ADR 0017 §14, #168) --------------------

const GREAT = WEAPONS.findIndex((w) => w.name === 'Greatsword');
const DAGGER = WEAPONS.findIndex((w) => w.name === 'Dagger');

// Prime a swing into the active window of a SPECIFIC weapon (its phase durations
// differ from the default), so the hit lands in one tick under that weapon.
function primeWeaponSwing(av: ServerAvatar, weapon: number): ServerAvatar {
	const w = weaponById(weapon);
	av.avatar.weapon = weapon;
	av.avatar.attackT = weaponSwingTotal(w) - w.swing.windup - w.swing.active / 2;
	return av;
}

test('the equipped weapon drives HP damage dealt through stepZone', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	const av = primeWeaponSwing(serverAvatar(7, 20), GREAT);
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	expect(next.zone.monsters[0].hp).toBe(100 - weaponById(GREAT).damage);
});

test('a heavy weapon breaks Poise where the default sword only chips (data alone)', () => {
	// A full-Poise Monster (max 16): the greatsword's 16 poise damage breaks it in one
	// connect, while the default sword's 8 only chips — same hit, different weapon.
	function breaks(weapon: number): boolean {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.hp = 100;
		const av = primeWeaponSwing(serverAvatar(7, 20), weapon);
		const next = stepZone(
			{ zone: zoneWith([m]), avatars: [av], tick: 0 },
			[attackRight(av)],
			16,
		);
		return (next.zone.monsters[0].stunT ?? 0) > 0;
	}
	expect(breaks(GREAT)).toBe(true);
	expect(breaks(DAGGER)).toBe(false);
});

test('a heavier weapon throws a broken body farther than a light one (Knockback from data)', () => {
	function breakIvx(weapon: number): number {
		const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
		m.hp = 100;
		m.poise = 1; // already near break so even the dagger's small poise damage breaks it
		const av = primeWeaponSwing(serverAvatar(7, 20), weapon);
		const next = stepZone(
			{ zone: zoneWith([m]), avatars: [av], tick: 0 },
			[attackRight(av)],
			16,
		);
		return next.zone.monsters[0].ivx ?? 0;
	}
	expect(breakIvx(GREAT)).toBeGreaterThan(breakIvx(DAGGER));
});

test('snapshotFor derives an Avatar action from its weapon phase durations', () => {
	// A greatsword swing primed mid-active under the DEFAULT phase total would read as
	// a different phase; the snapshot must interpret attackT against the weapon's own
	// swing, so the replicated action is genuinely `active`.
	const av = primeWeaponSwing(serverAvatar(7, 20), GREAT);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	const snap = snapshotFor(state, 7);
	expect(snap.avatars[0].action.move).toBe('basic');
	expect(snap.avatars[0].action.phase).toBe('active');
});
