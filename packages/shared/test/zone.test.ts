import { expect, test } from 'bun:test';
import type {
	AvatarIntent,
	Drop,
	Entity,
	Item,
	ServerAvatar,
	Zone,
	ZoneState,
} from '../src';
import {
	ACTION_FLAG,
	addAvatar,
	applyPoiseDamage,
	BOX,
	BRUTE,
	CAPABILITY_UNLOCK,
	COMBAT,
	clientStepAvatar,
	createZoneState,
	DEFAULT_COSMETICS,
	DEFAULT_WEAPON,
	DODGE_TOTAL,
	dodgePhase,
	entityTint,
	GROUND_TOP,
	lootTableFor,
	MONSTER,
	RESPAWN,
	removeAvatar,
	resolveDeaths,
	rollDrop,
	SPAWN,
	SWING_TOTAL,
	snapshotFor,
	spawnAvatar,
	spawnMonster,
	stepZone,
	swingPhase,
	weaponById,
	xpForKill,
	xpToNext,
} from '../src';
import { flatTerrain, makeProjectile } from './helpers';

const y = GROUND_TOP - BOX.h;

function serverAvatar(
	sessionId: number,
	x: number,
	handle = 'hero',
	// Level gates the capability verbs (ADR 0024 §5): default level 1 (attack only) for
	// the XP/kill tests; the block/dodge/skill tests raise it past the relevant unlock.
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

function zoneWith(monsters: Entity[], id = 'field-01'): Zone {
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

// A chaser parked mid-active-phase so its melee hitbox is live THIS tick (ADR 0017
// §9), placed to the left of an Avatar at x=20 and facing into it. `committed`
// (attackT > 0) suppresses a re-commit, so it lands exactly one active-phase strike.
function strikingCommitterAt20(): Entity {
	const m = spawnMonster('chaser', 2, 16, y); // facing-right hitbox (21..27) covers x=20
	m.onGround = true;
	m.facing = 1;
	m.attackT = MID_ACTIVE;
	return m;
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
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK['power-strike']);
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

test('the Avatar landing the killing blow earns the XP and, standing on the kill, collects its instanced loot', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4; // one swing kills
	const av = primeSwing(serverAvatar(7, 20));
	// The Dungeon is the reliable faucet — every kill drops (ADR 0024 §2) — so the roll is
	// deterministic. The killer stands on the kill site, so it grabs its own private Drop
	// the same tick (drop → collect-on-touch, both inside one stepZone).
	const state: ZoneState = {
		zone: zoneWith([m], 'dungeon-01'),
		avatars: [av],
		tick: 0,
	};
	const intent: AvatarIntent = { ...holdAt(7, av.avatar), attack: true };
	const next = stepZone(state, [intent], 16);
	expect(next.zone.monsters.length).toBe(0);
	const me = next.avatars[0];
	expect(me.progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	expect(me.inventory.length).toBe(1);
	expect(me.inventory[0].id).toBe(1); // from the killer's own nextId
	expect(next.zone.drops ?? []).toEqual([]); // collected, nothing left resting
});

test('a far contributor leaves its instanced Drop resting, then collects it on touch', () => {
	// Two contributors share a kill; the killer stands on it (auto-grabs), the helper is far
	// away, so the helper's PRIVATE Drop rests in the Zone until it walks over — the
	// reworked collect-on-touch mechanic (#238).
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4;
	m.contributors = [7, 8];
	const killer = primeSwing(serverAvatar(7, 20));
	const helper = serverAvatar(8, 300); // damaged it earlier, now across the Zone
	let state: ZoneState = {
		zone: zoneWith([m], 'dungeon-01'),
		avatars: [killer, helper],
		tick: 0,
	};
	state = stepZone(
		state,
		[{ ...holdAt(7, killer.avatar), attack: true }, holdAt(8, helper.avatar)],
		16,
	);
	expect(state.avatars[1].inventory.length).toBe(0); // not collected yet
	const resting = (state.zone.drops ?? []).filter((d) => d.owner === 8);
	expect(resting.length).toBe(1); // the helper's private Drop waits for it
	// Walk the helper onto its Drop; the overlap collects it into the helper's own bag.
	const d = resting[0];
	const onDrop: AvatarIntent = {
		...holdAt(8, state.avatars[1].avatar),
		x: d.x,
		y: d.y,
	};
	state = stepZone(state, [holdAt(7, state.avatars[0].avatar), onDrop], 16);
	expect(state.avatars[1].inventory.length).toBe(1); // grabbed on touch
	expect((state.zone.drops ?? []).some((x) => x.owner === 8)).toBe(false);
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

// --- Melee committer + no passive contact damage (ADR 0017 §9, #164) ---------

// Step a Zone for `ticks` 16ms frames, threading each step's output into the next
// while holding every Avatar in place (no attack). Returns the final state.
function holdSteps(state: ZoneState, ticks: number): ZoneState {
	let s = state;
	for (let i = 0; i < ticks; i++) {
		const intents = s.avatars.map((a) => holdAt(a.sessionId, a.avatar));
		s = stepZone(s, intents, 16);
	}
	return s;
}

test('overlapping a Monster deals NO contact damage (passive contact damage removed)', () => {
	// A chaser stacked on the Avatar but with its melee disabled (parked in a fake
	// recovery so it cannot commit): pure overlap, many ticks, zero damage.
	const m = spawnMonster('chaser', 2, 20, y); // stacked on the avatar
	m.onGround = true;
	m.attackT = SWING_TOTAL; // committed/recovering — never reaches the commit branch
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = holdSteps(state, 3); // only the wind-up elapses — no active strike yet
	expect(state.avatars[0].avatar.hp).toBe(before); // never chipped by contact
	expect(state.avatars[0].avatar.hurtT).toBe(0); // no hurt flash from a touch
});

test('a melee committer commits a telegraphed swing and damages ONLY in its active phase', () => {
	// Chaser just inside melee range of a stationary Avatar. It commits on the first
	// tick (wind-up, no damage), and the hit lands only once the swing reaches active.
	const m = spawnMonster('chaser', 2, 20 + MONSTER.meleeRange, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };

	// First tick: it commits — the action-state replicates a 'basic' swing in wind-up,
	// and no damage has landed yet (the telegraph the Player reads).
	state = stepZone(state, [holdAt(7, av.avatar)], 16);
	const snap = snapshotFor(state, 7);
	expect(snap.monsters[0].action.move).toBe('basic');
	expect(snap.monsters[0].action.phase).toBe('windup');
	expect(state.avatars[0].avatar.hp).toBe(before); // wind-up does not damage

	// March through the swing: HP only drops once, and on the damaging tick the
	// Monster's swing is in its active phase (the only window the hitbox is live).
	let damagedPhase: string | undefined;
	for (let i = 0; i < 30 && damagedPhase === undefined; i++) {
		const hpBefore = state.avatars[0].avatar.hp;
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		if (state.avatars[0].avatar.hp < hpBefore)
			damagedPhase = swingPhase(state.zone.monsters[0].attackT) ?? 'idle';
	}
	expect(damagedPhase).toBe('active'); // damage lands ONLY in the active window
	expect(state.avatars[0].avatar.hp).toBe(before - MONSTER.meleeDamage);
});

test('a committer cannot re-attack during its recovery — a punishable opening', () => {
	// Drive a full swing and find the recovery window: the Monster's attackT is still
	// > 0 (committed) yet its phase is recovery, so it deals no damage and the swing
	// has not restarted — the Player can punish.
	const m = spawnMonster('chaser', 2, 20 + MONSTER.meleeRange, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	// Make the Avatar immune to incoming damage so its presence can't be staggered
	// away — we only want to observe the Monster's swing timeline.
	state.avatars[0].avatar.hurtT = 100;

	let sawRecovery = false;
	for (let i = 0; i < 40; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		const mon = state.zone.monsters[0];
		if (swingPhase(mon.attackT) === 'recovery') {
			sawRecovery = true;
			// During recovery the committer is exposed: a Player swing connects and the
			// Monster takes the hit without it interrupting/cancelling the recovery.
			const punisher = primeSwing(
				serverAvatar(9, 20 + MONSTER.meleeRange - BOX.w),
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
			expect(punished.zone.monsters[0].hp).toBeLessThan(hpBefore); // recovery is punishable
			break;
		}
	}
	expect(sawRecovery).toBe(true);
});

test('a committer in its active phase can Stagger a poise-broken Avatar (full hit-reaction payload)', () => {
	// Prove the committer's strike carries the universal hit-reaction payload: with the
	// Avatar's Poise pre-broken-low, the active hit Staggers it (Hitstun + Knockback).
	const m = spawnMonster('chaser', 2, 20 + MONSTER.meleeRange, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	av.avatar.poise = 1; // one chip from a break
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	// Advance until the Avatar takes its hit.
	let staggered = false;
	for (let i = 0; i < 30 && !staggered; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		if ((state.avatars[0].avatar.stunT ?? 0) > 0) staggered = true;
	}
	expect(staggered).toBe(true);
	expect(state.avatars[0].avatar.ivx ?? 0).not.toBe(0); // knocked back
	expect(state.effects?.some((e) => e.kind === 'impact')).toBe(true);
});

// --- The heavy brute — a distinct melee committer (ADR 0024 §8, #237) --------

test('the heavy brute commits a telegraphed swing and damages ONLY in its active phase, for its heavy hit', () => {
	// Same commit → wind-up → active → recovery shape as the chaser, but the connect
	// deals the brute's much heavier HP damage — the "hard-hitting" half of its profile.
	const m = spawnMonster('brute', 2, 20 + BRUTE.meleeRange, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	av.avatar.hp = 999; // survive the heavy blow so we read one clean connect
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };

	// First tick: it commits — a 'basic' swing in wind-up telegraphs, no damage yet.
	state = stepZone(state, [holdAt(7, av.avatar)], 16);
	const snap = snapshotFor(state, 7);
	expect(snap.monsters[0].action.move).toBe('basic');
	expect(snap.monsters[0].action.phase).toBe('windup');
	expect(state.avatars[0].avatar.hp).toBe(before);

	// The hit lands exactly once, in the active window, for BRUTE.meleeDamage.
	let damagedPhase: string | undefined;
	for (let i = 0; i < 30 && damagedPhase === undefined; i++) {
		const hpBefore = state.avatars[0].avatar.hp;
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		if (state.avatars[0].avatar.hp < hpBefore)
			damagedPhase = swingPhase(state.zone.monsters[0].attackT) ?? 'idle';
	}
	expect(damagedPhase).toBe('active');
	expect(before - state.avatars[0].avatar.hp).toBe(BRUTE.meleeDamage);
	expect(BRUTE.meleeDamage).toBeGreaterThan(MONSTER.meleeDamage); // heavier than the chaser
});

test('overlapping a brute deals NO contact damage (it is a committer, never a contact mob)', () => {
	// Stacked on the Avatar but parked in a fake recovery so it never reaches its commit
	// branch: pure overlap, many ticks, zero damage — the "no passive contact" invariant.
	const m = spawnMonster('brute', 2, 20, y);
	m.onGround = true;
	m.attackT = SWING_TOTAL; // committed/recovering — never commits a fresh swing
	const av = serverAvatar(7, 20);
	const before = av.avatar.hp;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = holdSteps(state, 3); // only the wind-up elapses — no active strike yet
	expect(state.avatars[0].avatar.hp).toBe(before);
	expect(state.avatars[0].avatar.hurtT).toBe(0);
});

test('the brute is a poise-tank: it spawns with a much larger Poise pool than the default', () => {
	// The "high-poise" identity — the Player must chip far more before any of their hits
	// can Stagger it, so it shrugs off a flurry a chaser would break under.
	const m = spawnMonster('brute', 2, 30, y);
	expect(m.poiseMax).toBe(BRUTE.poiseMax);
	expect(BRUTE.poiseMax).toBeGreaterThan(COMBAT.poise.max);
	// A single default-strength poise hit does NOT break the brute (a chaser breaks in 2).
	const r = applyPoiseDamage(m, COMBAT.poiseDamage);
	expect(r.broke).toBe(false);
	expect(Math.ceil(BRUTE.poiseMax / COMBAT.poiseDamage)).toBeGreaterThan(
		Math.ceil(COMBAT.poise.max / COMBAT.poiseDamage),
	);
});

test('the brute attacks deliberately: a commit cool-down keeps it from re-swinging the instant it recovers', () => {
	// Unlike the chaser (commitCd 0, re-commits immediately), the brute must wait out its
	// cool-down after a swing — a long, punishable opening between heavy blows.
	const m = spawnMonster('brute', 2, 20 + BRUTE.meleeRange, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	// Immune, so its stagger can't move the Avatar out of range — observe cadence only.
	av.avatar.hurtT = 100;
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };

	// Run through the first full swing until it recovers back to idle (attackT 0).
	let sawSwing = false;
	for (let i = 0; i < 60; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		const at = state.zone.monsters[0].attackT;
		if (at > 0) sawSwing = true;
		if (sawSwing && at === 0) break;
	}
	expect(sawSwing).toBe(true);
	// It is still on cool-down, so the very next tick does NOT start a new swing.
	expect(state.zone.monsters[0].attackCdT ?? 0).toBeGreaterThan(0);
	state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
	expect(state.zone.monsters[0].attackT).toBe(0); // no immediate re-commit

	// …but the cadence is a pause, not a wedge: once the cool-down drains, the brute
	// DOES commit a second swing — so it keeps attacking, just deliberately.
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

// --- Dodge i-frames (ADR 0017 §5, #165) -------------------------------------

test('a Dodge negates a Monster strike during its i-frame active window', () => {
	// A committer lands an active-phase strike on an Avatar at x=20 THIS tick; the
	// Avatar is mid-Dodge (active window), so the hit is negated — the demo: dodge
	// through the active frames untouched.
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20);
	// dodgeT in the active window even after one tick of decay (elapsed < active).
	av.avatar.dodgeT = COMBAT.dodge.recovery + COMBAT.dodge.active * 0.5;
	const before = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(before); // i-frames negate the hit
	expect(next.avatars[0].avatar.hurtT).toBe(0); // no hurt flash
	expect(next.effects ?? []).toEqual([]); // no hurt blood either
});

test('a Dodge in its recovery window does NOT grant i-frames — the hit connects', () => {
	// Same striking committer, but the Avatar's Dodge has decayed into recovery: it is
	// exposed and committed, so the strike lands (a mistimed Dodge is punishable).
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20);
	av.avatar.dodgeT = COMBAT.dodge.recovery * 0.5; // mid recovery, vulnerable
	const before = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(next.avatars[0].avatar.hp).toBe(before - MONSTER.meleeDamage); // connects
});

test('a Dodge slips a projectile during its active window but not its recovery', () => {
	// The same i-frame gate covers ranged hits: an active Dodge passes through a shot.
	const shot = makeProjectile({ x: 20, y, life: 1 });
	const zone: Zone = { ...zoneWith([]), projectiles: [shot] };
	const av = serverAvatar(7, 20);
	av.avatar.dodgeT = COMBAT.dodge.recovery + COMBAT.dodge.active * 0.5; // active
	const before = av.avatar.hp;
	const next = stepZone(
		{ zone, avatars: [av], tick: 0 },
		[holdAt(7, av.avatar)],
		16,
	);
	expect(next.avatars[0].avatar.hp).toBe(before); // slipped — no damage
	expect(next.zone.projectiles.length).toBe(1); // and the shot was NOT consumed
});

test('a dodge intent loads the i-frame timer through stepZone (active on the first tick)', () => {
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.dodge);
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	// The report carries the client's already-gated `dodge` decision (grounded + moving
	// were verified client-side pre-hop); the server loads the i-frame timer on trust.
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), dodge: true }], 16);
	const d = next.avatars[0].avatar.dodgeT ?? 0;
	expect(d).toBeGreaterThan(0);
	expect(d).toBeLessThanOrEqual(DODGE_TOTAL);
	expect(dodgePhase(d)).toBe('active'); // invulnerable on the start tick
	// And the action-state replicates the dodge so other Players can see it.
	const snap = snapshotFor(next, 7);
	const me = snap.avatars.find((a) => a.sessionId === 7);
	expect(me?.action.move).toBe('dodge');
});

// --- Guard: Block vs a committer's strike (ADR 0017 §5, #166) ----------------
//
// strikingCommitterAt20() is a chaser parked mid-active at x=16 (to the LEFT of an
// Avatar at x=20), striking THIS tick. A frontal Guard needs the Avatar to face the
// committer (-1); facing away (+1) is a rear hit Guard ignores. A guard intent for a
// stationary Avatar at x=20.
function guardIntent(
	sessionId: number,
	e: Entity,
	over: Partial<AvatarIntent> = {},
): AvatarIntent {
	return { ...holdAt(sessionId, e), guard: true, ...over };
}

test('Block: a frontal committer strike is chipped, not full, and drains Poise', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = -1; // face the committer on the left (frontal)
	av.avatar.guardT = 0.5; // a raised Guard → Block
	const poiseBefore = av.avatar.poise ?? COMBAT.poise.max;
	const hpBefore = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const out = next.avatars[0].avatar;
	// Chip, not the full MONSTER.meleeDamage.
	expect(hpBefore - out.hp).toBe(
		Math.ceil(MONSTER.meleeDamage * COMBAT.guard.blockChip),
	);
	expect(hpBefore - out.hp).toBeLessThan(MONSTER.meleeDamage);
	expect(out.poise ?? COMBAT.poise.max).toBeLessThan(poiseBefore); // Poise drained
	expect(out.stunT ?? 0).toBe(0); // a chip-block does not Stagger
	// A clean Block emits no hurt-blood — the brace soaked it.
	expect(next.effects?.some((e) => e.kind === 'blood')).toBeFalsy();
});

test('an unguarded committer chip emits source-less hurt-blood biased away from the Monster', () => {
	// Incoming hurt is NEVER predicted (ADR 0013 §3 / ADR 0019): the chip resolves to a
	// `hit` CombatEvent with NO `source`, so the snapshot delivers the blood to the victim
	// too, in lockstep with the hurt-flash. Biased away from the Monster (committer at
	// x=16, Avatar at x=20 → dir +1). An unbroken Avatar takes a chip, not a Stagger.
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20); // full Poise → one strike chips, never breaks
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [holdAt(7, av.avatar)], 16);
	const blood = next.effects?.find((e) => e.kind === 'blood');
	expect(blood?.dir).toBe(1); // away from the committer on the left
	expect(blood?.source).toBeUndefined(); // server-authoritative, unpredicted
	expect(next.avatars[0].avatar.stunT ?? 0).toBe(0); // a chip, not a break
});

test('Block to a Poise break is a guard-break Stagger', () => {
	const m = strikingCommitterAt20();
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = -1;
	av.avatar.guardT = 0.5; // a raised Guard → Block
	av.avatar.poise = COMBAT.guard.blockPoise - 1; // one block empties the pool
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const out = next.avatars[0].avatar;
	expect(out.stunT ?? 0).toBeGreaterThan(0); // guard-break Staggers the turtler
	expect(out.ivx ?? 0).not.toBe(0); // and throws the body
	expect(next.effects?.some((e) => e.kind === 'impact')).toBe(true);
});

test('Guard only protects the frontal arc — a rear strike ignores it', () => {
	const m = strikingCommitterAt20(); // attacker to the LEFT
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = 1; // facing AWAY from the committer (rear hit)
	av.avatar.guardT = 0.5; // a raised Guard — but the hit lands from behind
	const hpBefore = av.avatar.hp;
	const state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const out = next.avatars[0].avatar;
	expect(hpBefore - out.hp).toBe(MONSTER.meleeDamage); // full damage — Guard ignored
});

test('a guarding Avatar replicates the guarding flag to others (ADR 0017 §10)', () => {
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = -1;
	const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
	const next = stepZone(state, [guardIntent(7, av.avatar)], 16);
	const snap = snapshotFor(next, 9); // some other session's view
	const flags = snap.avatars[0].action.flags;
	expect(flags & ACTION_FLAG.guarding).toBeTruthy();
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
		zone: zoneWith([m], 'dungeon-01'),
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
	expect(next.avatars[0].progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	expect(next.avatars[0].inventory.length).toBe(1); // killer grabs its Drop on the kill
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
	expect(next.zone.drops ?? []).toEqual([]); // no Drop for the uninvolved bystander
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
		zone: zoneWith([m], 'dungeon-01'),
		avatars: [killer, helper],
		tick: 0,
	};
	const next = stepZone(
		state,
		[{ ...holdAt(7, killer.avatar), attack: true }, holdAt(8, helper.avatar)],
		16,
	);
	expect(next.zone.monsters.length).toBe(0);
	// Shared, not split: each contributor gets the FULL kill XP immediately.
	expect(next.avatars[0].progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	expect(next.avatars[1].progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	// The killer stands on the kill, so it collects its own instanced Drop this tick.
	expect(next.avatars[0].inventory.length).toBe(1);
	// The helper is far away: its private Drop rests in the Zone for it alone, uncollected.
	expect(next.avatars[1].inventory.length).toBe(0);
	const helperDrops = (next.zone.drops ?? []).filter((d) => d.owner === 8);
	expect(helperDrops.length).toBe(1);
	// Seeded per-Player (instanced): the helper's Drop is exactly the dungeon-table roll
	// off its OWN seed, proving loot never crosses between contributors.
	const expected = rollDrop(
		999,
		next.avatars[1].progress.level,
		lootTableFor('dungeon-01'),
	);
	if (!expected.item) throw new Error('dungeon table must always drop');
	expect(helperDrops[0].item).toEqual({ ...expected.item, id: 1 });
});

test('a kill that crosses a skill-unlock rung logs a specific "Unlocked: <skill> [<key>]!" line (#271)', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 4; // the next swing kills it, granting XP
	// Poised one XP short of L3 at level 2, so the kill's XP tips the Player over the
	// Power Strike (L3) rung — exactly one level, so only that skill unlocks.
	const killer = primeSwing(serverAvatar(7, 20, 'hero', 2));
	killer.progress = { level: 2, xp: xpToNext(2) - 1, gold: 0 };
	const state: ZoneState = { zone: zoneWith([m]), avatars: [killer], tick: 0 };
	const next = stepZone(
		state,
		[{ ...holdAt(7, killer.avatar), attack: true }],
		16,
	);
	const me = next.avatars[0];
	expect(me.progress.level).toBe(3); // crossed exactly one rung
	expect(me.log).toContain('Level up! Now level 3.'); // existing line intact
	expect(me.log).toContain('Unlocked: Power Strike [u]!');
	// Ground Pound (L5) was NOT crossed, so its line must not appear.
	expect(me.log.some((l) => l.includes('Ground Pound'))).toBe(false);
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
	expect(next.avatars[0].progress.xp).toBe(xpForKill('chaser', 'field-01'));
	expect(next.avatars[1].progress.xp).toBe(0);
	expect(next.avatars[1].inventory.length).toBe(0);
});

// A minimal loot Item for the Drop fixtures below.
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
	// A Drop resting far from its owner with almost no ttl left: one tick drains it and it
	// is gone — grab it before it vanishes (#238).
	const owner = serverAvatar(7, 20);
	const drop: Drop = {
		id: 1,
		owner: 7,
		item: testItem(),
		x: 300, // across the Zone from the owner at x=20 — never overlaps
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
	expect(next.zone.drops ?? []).toEqual([]); // faded, not collected
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
	// 7 sees only its own Drop; 8 sees only its own — never a rival's pickup.
	expect(snapshotFor(state, 7).drops.map((d) => d.owner)).toEqual([7]);
	expect(snapshotFor(state, 8).drops.map((d) => d.owner)).toEqual([8]);
});

test('an Avatar reduced to 0 HP respawns at the safe point at full HP', () => {
	const av = serverAvatar(7, 20);
	av.avatar.hp = 1;
	const m = strikingCommitterAt20(); // active-phase strike finishes the 1-HP Avatar
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
	const m = strikingCommitterAt20(); // active-phase strike finishes the 1-HP Avatar
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
	const m = strikingCommitterAt20(); // active-phase strike finishes the 1-HP Avatar
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
	const pr = makeProjectile({
		x: 22, // overlapping the Avatar's box
		y: av.avatar.y + 2,
		vx: -36, // travelling left: away from a shooter on the right
		damage: 7,
		life: 1,
	});
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
	expect(next.effects ?? []).toEqual([]);
});

// --- Ranged poker + first-class projectiles + counterplay (ADR 0017 §8, #169) ----

test('a ranged poker telegraphs through stepZone: it commits a swing and fires only on the active frame', () => {
	// A shooter within aggro of an Avatar commits the wind-up→active→recovery swing
	// (visible action-state) but does NOT fire on the commit tick — the pebble appears
	// only when the swing crosses into `active` (no auto-fire, ADR 0017 §8).
	const m = spawnMonster('shooter', 2, 50, y);
	m.onGround = true;
	const av = serverAvatar(7, 20);
	let state: ZoneState = { zone: zoneWith([m]), avatars: [av], tick: 0 };
	state = stepZone(state, [holdAt(7, av.avatar)], 16);
	expect(state.zone.monsters[0].attackT).toBeGreaterThan(0); // committed
	expect(state.zone.projectiles.length).toBe(0); // but no shot yet (wind-up)
	// The wind-up is replicated so the Player can read the telegraph.
	const snap = snapshotFor(state, 7);
	expect(snap.monsters[0].action.move).toBe('basic');
	// Drive the swing into its active phase; exactly one shot is fired, aimed at the Avatar.
	let fired = state.zone.projectiles;
	for (let i = 0; i < 12 && fired.length === 0; i++) {
		state = stepZone(state, [holdAt(7, state.avatars[0].avatar)], 16);
		fired = state.zone.projectiles;
	}
	expect(fired.length).toBe(1);
	expect(fired[0].vx).toBeLessThan(0); // aimed left, toward the Avatar at x=20
});

test('an unguarded heavy projectile Staggers the Avatar on a Poise break, like a melee hit', () => {
	// First-class hit (ADR 0017 §8): the payload, not just damage. A shot whose poise
	// damage empties the pool breaks it → Hitstun + a Knockback impulse, the same path a
	// melee connect uses.
	const av = serverAvatar(7, 20);
	const pr = makeProjectile({
		x: 22,
		y: av.avatar.y + 2,
		vx: 36, // travelling right
		damage: 7,
		poiseDamage: 20, // > the Avatar's pool (16) → break
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
	expect(next.stunT ?? 0).toBeGreaterThan(0); // Staggered
	expect(next.ivx ?? 0).toBeGreaterThan(0); // thrown along the shot's travel
});

test('Block: a frontal Guard chips a projectile, drains Poise, and consumes the shot', () => {
	const av = serverAvatar(7, 20, 'hero', CAPABILITY_UNLOCK.block);
	av.avatar.facing = 1; // face the shot coming from the right (frontal)
	av.avatar.guardT = 0.5; // a raised Guard → Block
	const pr = makeProjectile({
		x: 22,
		y: av.avatar.y + 2,
		vx: -36, // travelling left, from the right
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
	expect(a.hp).toBe(av.avatar.hp - Math.ceil(8 * COMBAT.guard.blockChip)); // chip, not full
	expect(a.poise ?? COMBAT.poise.max).toBeLessThan(COMBAT.poise.max); // Poise drained
	expect(next.zone.projectiles.length).toBe(0); // the brace stopped the shot
});

test('Swat: a live active melee frame DESTROYS a hostile shot', () => {
	const av = primeSwing(serverAvatar(7, 20)); // swing live in its active phase this tick
	av.avatar.facing = 1; // hitbox projects to the right (x 25..31)
	const pr = makeProjectile({
		x: 27, // inside the melee hitbox, outside the body box
		y: av.avatar.y + 2,
		vx: -36, // a hostile shot incoming from the right
		damage: 7,
		life: 1,
	});
	const state: ZoneState = {
		zone: { ...zoneWith([]), projectiles: [pr] },
		avatars: [av],
		tick: 0,
	};
	const next = stepZone(state, [{ ...holdAt(7, av.avatar), attack: true }], 16);
	expect(next.zone.projectiles.length).toBe(0); // swatted out of the air
	expect(next.avatars[0].avatar.hp).toBe(av.avatar.hp); // took no damage
	// The swat emits a `swat` CombatEvent → a LIGHT impact clink (ADR 0019): at the
	// shot, intensity = the shot's own damage with NO poise.max bump (unlike a break),
	// and source-less so everyone in range gets the clink + camera juice.
	const clink = next.effects?.find((e) => e.kind === 'impact');
	expect(clink?.intensity).toBe(7); // the shot's damage, not damage + poise.max
	expect(clink?.source).toBeUndefined();
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

// --- Weapon = damage + visuals only; one shared moveset (ADR 0024, #232) ----

test('a landed swing deals the equipped weapon damage but the SHARED poise chip', () => {
	// The weapon contributes its damage and nothing else to resolution: the Poise
	// chip comes from the one COMBAT constant, so no weapon staggers faster from data.
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
	// Whatever the equipped index (the default, or a forward-version one that clamps),
	// a swing primed mid-active under the SHARED phase total replicates as `active` —
	// there are no per-weapon phase durations left to diverge on.
	for (const weapon of [DEFAULT_WEAPON, 999]) {
		const av = primeSwing(serverAvatar(7, 20));
		av.avatar.weapon = weapon;
		const state: ZoneState = { zone: zoneWith([]), avatars: [av], tick: 0 };
		const snap = snapshotFor(state, 7);
		expect(snap.avatars[0].action.move).toBe('basic');
		expect(snap.avatars[0].action.phase).toBe('active');
	}
});

test('a Poise break throws the body along the swing — the SHARED Knockback', () => {
	const m = spawnMonster('chaser', 2, 20 + BOX.w, y);
	m.hp = 100;
	m.poise = 1; // on the brink so the shared chip breaks it this hit
	const av = primeSwing(serverAvatar(7, 20));
	const next = stepZone(
		{ zone: zoneWith([m]), avatars: [av], tick: 0 },
		[attackRight(av)],
		16,
	);
	expect(next.zone.monsters[0].stunT ?? 0).toBeGreaterThan(0);
	expect(next.zone.monsters[0].ivx ?? 0).toBeGreaterThan(0);
});

// --- resolveDeaths: the death-consequences pass (ADR 0022 slice 5) -----------
// resolveDeaths is the distinct pass that consumes the death set and applies world-state
// consequences — separated from the death *decision* (lethal damage, applied during combat
// resolution, is what makes a contact a death). It preserves the monster-local /
// avatar-escalates asymmetry: monsters pay out fully zone-local (XP + instanced-loot Drops +
// respawn scheduling), avatars emit only the transient died-this-tick set + in-place respawn.
// These unit tests exercise the pass directly, off already-decided death fixtures.
const deadCtx = (zoneId = 'dungeon-01', nextDropId = 1) => ({
	zoneId,
	lootTable: lootTableFor(zoneId),
	nextDropId,
});

test('resolveDeaths grants each dead Monster contributor shared XP and its own instanced loot', () => {
	const killer = serverAvatar(7, 20);
	const helper = serverAvatar(8, 300);
	helper.rngState = 999; // a distinct loot seed, to prove instancing
	const m = spawnMonster('chaser', 2, 20, y);
	m.hp = 0; // already decided dead by combat resolution
	m.contributors = [7, 8];
	const out = resolveDeaths([killer, helper], [m], deadCtx());
	// Shared, not split: each contributor earns the FULL kill XP.
	expect(out.avatars[0].progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	expect(out.avatars[1].progress.xp).toBe(xpForKill('chaser', 'dungeon-01'));
	// The dungeon table always drops: each contributor gets its OWN private Drop, at the
	// kill site, owned by that session (instanced — no shared pile).
	expect(out.drops.map((d) => d.owner).sort()).toEqual([7, 8]);
	// Seeded per-Player: the helper's Drop is exactly the dungeon-table roll off its OWN
	// seed, proving loot never crosses between contributors.
	const expected = rollDrop(
		999,
		out.avatars[1].progress.level,
		lootTableFor('dungeon-01'),
	);
	if (!expected.item) throw new Error('dungeon table must always drop');
	const helperDrop = out.drops.find((d) => d.owner === 8);
	expect(helperDrop?.item).toEqual({ ...expected.item, id: 1 });
	// Drop ids advance from the passed cursor; it is returned for the caller to thread on.
	expect(out.nextDropId).toBe(3);
});

test('resolveDeaths reports the died-this-tick set and defers the respawn to the caller', () => {
	const dead = serverAvatar(7, 200);
	dead.avatar.hp = 0; // combat resolution already brought it to 0
	const alive = serverAvatar(8, 50);
	const out = resolveDeaths([dead, alive], [], deadCtx());
	// Only the dead session is reported; the survivor is untouched.
	expect(out.deaths).toEqual([7]);
	expect(out.avatars[1].avatar.hp).toBe(alive.avatar.maxHp);
	expect(out.avatars[1].avatar.x).toBe(50);
	// The pass REPORTS the death but does NOT respawn: the in-place safe-point respawn is the
	// caller's job (it runs after loot collection), so the fallen Avatar is left unmoved here.
	expect(out.avatars[0].avatar.x).toBe(200);
	expect(out.avatars[0].avatar.hp).toBe(0);
});

test('resolveDeaths sprays a radial gore Effect at the fall site', () => {
	const dead = serverAvatar(7, 200);
	dead.avatar.hp = 0;
	const out = resolveDeaths([dead], [], deadCtx());
	const death = out.effects.find(
		(fx) => fx.dir === 0 && fx.intensity === COMBAT.deathBurstIntensity,
	);
	expect(death?.kind).toBe('gore');
	// at the fall spot (x ~200); the caller respawns to SPAWN.x afterwards.
	expect(death?.x).toBeGreaterThanOrEqual(200);
});

test('resolveDeaths schedules a respawn for a dead Monster that has a spawn point', () => {
	const m = spawnMonster('chaser', 2, 20, y, 3); // spawnIndex 3
	m.hp = 0;
	const out = resolveDeaths([], [m], deadCtx());
	expect(out.respawns).toEqual([
		{ spawnIndex: 3, remaining: RESPAWN.delaySec },
	]);
});

test('resolveDeaths schedules no respawn for a Monster with no spawn point', () => {
	const m = spawnMonster('chaser', 2, 20, y); // no spawnIndex (an ad-hoc spawn)
	m.hp = 0;
	const out = resolveDeaths([], [m], deadCtx());
	expect(out.respawns).toEqual([]);
});

test('resolveDeaths pays out nothing for a Monster with no contributors', () => {
	const bystander = serverAvatar(7, 20);
	const m = spawnMonster('chaser', 2, 20, y); // never damaged — no contributors
	m.hp = 0;
	const out = resolveDeaths([bystander], [m], deadCtx());
	expect(out.avatars[0].progress.xp).toBe(0);
	expect(out.drops).toEqual([]);
});
