import { describe, expect, test } from 'bun:test';
import {
	ACTION_FLAG,
	actionFlags,
	actionStateOf,
	applyPoiseDamage,
	avatarHittable,
	BOX,
	BRUTE,
	bladeEdgeArc,
	COMBAT,
	canStartDodge,
	combatEventAt,
	DODGE_LOCKOUT,
	DODGE_TOTAL,
	deathEvent,
	dodgeInvulnerable,
	dodgePhase,
	dodgeProgress,
	dodgeReady,
	type Entity,
	entityBox,
	entityTint,
	facingToward,
	GROUND_POUND,
	guardPoseCell,
	guardPoseGlyph,
	guardRaised,
	IDLE_ACTION,
	MONSTER,
	meleeActive,
	meleeHitbox,
	meleeProfileOf,
	POWER_STRIKE,
	PROGRESSION,
	type Projectile,
	predictHits,
	regenPoise,
	resolveCombat,
	resolveGuard,
	resolveHitsOnMonsters,
	type Strike,
	SWING_TOTAL,
	skillHitbox,
	stepAvatarCombat,
	superArmorActive,
	swatEvent,
	sweepIndex,
	swingHitsTarget,
	swingPhase,
	swingPose,
	swingPoseCell,
	swingPoseGlyph,
	swingProgress,
	type Weapon,
	weaponById,
	weaponFrame,
} from '../src';

function monster(x: number, y: number, over: Partial<Entity> = {}): Entity {
	return {
		id: 1,
		type: 'chaser',
		x,
		y,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

function projectile(over: Partial<Projectile> = {}): Projectile {
	return {
		id: 1,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		life: 1,
		damage: 7,
		poiseDamage: 6,
		knockback: 30,
		knockbackUp: 10,
		...over,
	};
}

describe('combatEventAt', () => {
	test('resolves an entity-centred event at the target centre, biased + scaled', () => {
		const m = monster(10, 4);
		expect(combatEventAt('hit', m, 1, 8)).toEqual({
			kind: 'hit',
			targetId: m.id,
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: 8,
			dir: 1,
		});
	});

	test('a radial dir 0 survives — a hit whose source shares the victim column', () => {
		expect(combatEventAt('hit', monster(0, 0), 0, 7).dir).toBe(0);
	});

	test('a `hit` carries the attributing session as source when given', () => {
		const e = combatEventAt('hit', monster(0, 0), -1, 5, 42);
		expect(e.dir).toBe(-1);
		expect(e.kind === 'hit' && e.source).toBe(42);
	});

	test('a `break` is source-less even if a source is passed — it reaches everyone', () => {
		expect(combatEventAt('break', monster(0, 0), 1, 6)).not.toHaveProperty(
			'source',
		);
	});
});

describe('entityTint', () => {
	test('a monster takes its sprite body colour (chaser = red)', () => {
		expect(entityTint(monster(0, 0, { type: 'chaser' }))).toEqual({
			r: 220,
			g: 90,
			b: 90,
		});
	});

	test('a different monster takes its own body colour (shooter = bone)', () => {
		expect(entityTint(monster(0, 0, { type: 'shooter' }))).toEqual({
			r: 232,
			g: 230,
			b: 216,
		});
	});

	test('the heavy brute takes its steel-grey body colour', () => {
		expect(entityTint(monster(0, 0, { type: 'brute' }))).toEqual({
			r: 186,
			g: 196,
			b: 210,
		});
	});

	test('an Avatar takes its cosmetic hue, not the default body colour', () => {
		const a = monster(0, 0, {
			type: 'player',
			cosmetics: { hue: 3, hat: 0, nameplate: 0, form: 0 },
		});
		expect(entityTint(a)).toEqual({ r: 90, g: 170, b: 255 });
	});

	test('a stray cosmetic hue falls back to the default amber body', () => {
		const a = monster(0, 0, {
			type: 'player',
			cosmetics: { hue: 999, hat: 0, nameplate: 0, form: 0 },
		});
		expect(entityTint(a)).toEqual({ r: 255, g: 150, b: 40 });
	});
});

describe('meleeProfileOf', () => {
	test('the chaser is a melee committer with the light chaser profile', () => {
		const p = meleeProfileOf('chaser');
		expect(p).not.toBeNull();
		expect(p?.damage).toBe(MONSTER.meleeDamage);
		expect(p?.range).toBe(MONSTER.meleeRange);
		expect(p?.commitCd).toBe(0);
	});

	test('the brute is a melee committer whose profile is heavier and slower than the chaser', () => {
		const c = meleeProfileOf('chaser');
		const b = meleeProfileOf('brute');
		expect(b).not.toBeNull();
		expect(b?.damage).toBe(BRUTE.meleeDamage);
		expect(b?.poise).toBe(BRUTE.meleePoise);
		expect(b?.range).toBe(BRUTE.meleeRange);
		expect(b?.damage).toBeGreaterThan(c?.damage ?? 0);
		expect(b?.poise).toBeGreaterThan(c?.poise ?? 0);
		expect(b?.commitCd).toBeGreaterThan(0);
	});

	test('the ranged-poker shooter and the player are not melee committers', () => {
		expect(meleeProfileOf('shooter')).toBeNull();
		expect(meleeProfileOf('player')).toBeNull();
	});
});

describe('deathEvent', () => {
	test('is a radial (dir 0) death event at the entity centre, high intensity, entity-tinted', () => {
		const m = monster(10, 4, { type: 'chaser' });
		expect(deathEvent(m)).toEqual({
			kind: 'death',
			targetId: m.id,
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			dir: 0,
			intensity: COMBAT.deathBurstIntensity,
			tint: { r: 220, g: 90, b: 90 },
		});
	});

	test('an Avatar death recolours the tint to its cosmetic hue, not a body colour', () => {
		const a = monster(10, 4, {
			type: 'player',
			cosmetics: { hue: 3, hat: 0, nameplate: 0, form: 0 },
		});
		expect(deathEvent(a)).toEqual({
			kind: 'death',
			targetId: a.id,
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			dir: 0,
			intensity: COMBAT.deathBurstIntensity,
			tint: { r: 90, g: 170, b: 255 },
		});
	});

	test('reads visibly bigger than a chip hit — intensity above melee damage', () => {
		expect(COMBAT.deathBurstIntensity).toBeGreaterThan(COMBAT.meleeDamage);
	});

	test('carries no source — death gore is delivered to everyone in range', () => {
		expect(deathEvent(monster(0, 0))).not.toHaveProperty('source');
	});
});

describe('swingHitsTarget', () => {
	const attacker = monster(0, 0, { facing: 1 });
	const hb = meleeHitbox(attacker);

	test('strikes an overlapping target not yet in the swing registry', () => {
		const target = monster(hb.x, hb.y, { id: 7 });
		expect(swingHitsTarget(hb, new Set(), target)).toBe(true);
	});

	test('does NOT strike a target already in the registry — the dedup gate', () => {
		const target = monster(hb.x, hb.y, { id: 7 });
		expect(swingHitsTarget(hb, new Set([7]), target)).toBe(false);
	});

	test('the registry, NOT hurtT, is the gate — an i-framed target still strikes', () => {
		const target = monster(hb.x, hb.y, { id: 7, hurtT: 0.3 });
		expect(swingHitsTarget(hb, new Set(), target)).toBe(true);
	});

	test('no overlap and a null hitbox both miss', () => {
		const far = monster(hb.x + 100, hb.y, { id: 7 });
		expect(swingHitsTarget(hb, new Set(), far)).toBe(false);
		expect(swingHitsTarget(null, new Set(), monster(hb.x, hb.y))).toBe(false);
	});
});

describe('resolveHitsOnMonsters', () => {
	const strikeAt = (
		hitbox: ReturnType<typeof entityBox>,
		over: Partial<Strike> = {},
	): Strike => ({
		attackerId: 7,
		attackerKind: 'avatar',
		hitbox,
		damage: 8,
		poiseDamage: 6,
		facing: 1,
		faction: 'players',
		...over,
	});
	const ledger = () => new Map<number, Set<number>>([[7, new Set()]]);

	test('a player Strike damages an overlapping monster and records the victim', () => {
		const m = monster(10, 0, { id: 1, hp: 20 });
		const swingHits = ledger();
		const { monsters, events } = resolveHitsOnMonsters(
			[m],
			[strikeAt(entityBox(m))],
			swingHits,
		);
		expect(monsters[0].hp).toBe(12);
		expect(swingHits.get(7)?.has(1)).toBe(true);
		expect(events.length).toBeGreaterThan(0);
		expect(events[0].kind).toBe('hit');
		expect(events[0].kind === 'hit' && events[0].source).toBe(7);
	});

	test('a non-overlapping monster is a no-op', () => {
		const m = monster(500, 0, { id: 1, hp: 20 });
		const swingHits = ledger();
		const { monsters, events } = resolveHitsOnMonsters(
			[m],
			[strikeAt({ x: 0, y: 0, w: BOX.w, h: BOX.h })],
			swingHits,
		);
		expect(monsters[0].hp).toBe(20);
		expect(swingHits.get(7)?.size).toBe(0);
		expect(events).toEqual([]);
	});

	test('an already-hit monster (in the swing ledger) is a no-op — one hit per swing', () => {
		const m = monster(10, 0, { id: 1, hp: 20 });
		const swingHits = new Map<number, Set<number>>([[7, new Set([1])]]);
		const { monsters, events } = resolveHitsOnMonsters(
			[m],
			[strikeAt(entityBox(m))],
			swingHits,
		);
		expect(monsters[0].hp).toBe(20);
		expect(events).toEqual([]);
	});

	test('a same-faction (monsters) Strike never selects a Monster victim — PvE by faction', () => {
		const m = monster(10, 0, { id: 1, hp: 20 });
		const swingHits = ledger();
		const { monsters, events } = resolveHitsOnMonsters(
			[m],
			[strikeAt(entityBox(m), { faction: 'monsters' })],
			swingHits,
		);
		expect(monsters[0].hp).toBe(20);
		expect(swingHits.get(7)?.size).toBe(0);
		expect(events).toEqual([]);
	});

	test('a Poise break Staggers + knocks back the monster and emits a break event', () => {
		// poise 5 < the 6 poiseDamage, so this hit empties the pool and breaks it.
		const m = monster(10, 0, { id: 1, hp: 20, poise: 5 });
		const swingHits = ledger();
		const { monsters, events } = resolveHitsOnMonsters(
			[m],
			[strikeAt(entityBox(m))],
			swingHits,
		);
		expect(monsters[0].hp).toBe(12);
		expect(monsters[0].stunT).toBeGreaterThan(0);
		expect(events.some((e) => e.kind === 'break')).toBe(true);
	});
});

describe('predictHits', () => {
	const attacker = monster(0, 0, { facing: 1 });
	const hb = meleeHitbox(attacker);

	test('emits one hit CombatEvent per overlapping monster, at its centre', () => {
		const target = monster(hb.x, hb.y, { id: 7 });
		const events = predictHits(hb, 1, 8, new Set(), [target]);
		expect(events).toEqual([combatEventAt('hit', target, 1, 8)]);
	});

	test('a null hitbox (no live swing) predicts nothing', () => {
		expect(predictHits(null, 1, 8, new Set(), [monster(hb.x, hb.y)])).toEqual(
			[],
		);
	});

	test('never attaches a source — predicted events are not reported upward', () => {
		const events = predictHits(hb, 1, 8, new Set(), [monster(hb.x, hb.y)]);
		expect(events[0]).not.toHaveProperty('source');
	});

	test('a multi-tick active window yields exactly one hit per target per swing', () => {
		const target = monster(hb.x, hb.y, { id: 7 });
		const swingHits = new Set<number>();
		let total = 0;
		for (let tick = 0; tick < 14; tick++) {
			const events = predictHits(hb, 1, 8, swingHits, [target]);
			total += events.length;
			for (const e of events) swingHits.add(e.targetId);
		}
		expect(total).toBe(1);
		swingHits.clear();
		expect(predictHits(hb, 1, 8, swingHits, [target])).toHaveLength(1);
	});

	test('predicted hits are source-less hit CombatEvents at the target centre', () => {
		const target = monster(hb.x, hb.y, { id: 7 });
		const events = predictHits(hb, 1, 8, new Set(), [target]);
		expect(events).toEqual([
			{
				kind: 'hit',
				targetId: 7,
				x: target.x + BOX.w / 2,
				y: target.y + BOX.h / 2,
				intensity: 8,
				dir: 1,
			},
		]);
	});
});

describe('resolveCombat', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });

	test('starting a basic swing loads the full phase sequence and is in wind-up (no hitbox yet)', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(r.attackT).toBe(SWING_TOTAL);
		expect(swingPhase(r.attackT)).toBe('windup');
		expect(r.hitbox).toBeNull();
		expect(r.skillFired).toBeUndefined();
	});

	test('the melee hitbox is live ONLY during the active phase', () => {
		const { windup, active } = COMBAT.swing;
		const inActive = SWING_TOTAL - (windup + active / 2);
		const r1 = resolveCombat(
			avatar({ attackT: inActive }),
			{},
			1,
			'warrior',
			{ attack: false },
			0,
		);
		expect(swingPhase(r1.attackT)).toBe('active');
		expect(r1.hitbox).toEqual(meleeHitbox(avatar()));
		expect(r1.damage).toBe(COMBAT.meleeDamage);

		const inRecovery = SWING_TOTAL - (windup + active + 0.01);
		const r2 = resolveCombat(
			avatar({ attackT: inRecovery }),
			{},
			1,
			'warrior',
			{ attack: false },
			0,
		);
		expect(swingPhase(r2.attackT)).toBe('recovery');
		expect(r2.hitbox).toBeNull();
	});

	test('a fresh attack press mid-swing does not restart the swing (stays committed)', () => {
		const a = avatar({ attackT: 0.1 });
		const before = a.attackT;
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.02);
		expect(r.attackT).toBeCloseTo(before - 0.02, 5);
		expect(r.attackT).toBeLessThan(SWING_TOTAL);
	});

	test('a new swing can start once the prior swing has fully recovered (idle)', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(r.attackT).toBe(SWING_TOTAL);
	});

	test('a skill is gated when level < unlockLevel', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(
			a,
			{},
			1,
			'warrior',
			{ attack: false, skill: 2 },
			0.016,
		);
		expect(r.skillFired).toBeUndefined();
		expect(r.cooldowns[GROUND_POUND.id]).toBeUndefined();
		expect(r.hitbox).toBeNull();
	});

	test('a skill is gated while on cooldown', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(
			a,
			{ [POWER_STRIKE.id]: 1.0 },
			1,
			'warrior',
			{ attack: false, skill: 1 },
			0.1,
		);
		expect(r.skillFired).toBeUndefined();
		expect(r.hitbox).toBeNull();
		expect(r.cooldowns[POWER_STRIKE.id]).toBeCloseTo(0.9, 5);
	});

	test('a fired skill overrides the basic swing', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(
			a,
			{},
			POWER_STRIKE.unlockLevel,
			'warrior',
			{ attack: true, skill: 1 },
			0.016,
		);
		expect(r.skillFired).toBe(POWER_STRIKE);
		expect(r.hitbox).toEqual(skillHitbox(a, POWER_STRIKE));
		expect(r.damage).toBe(POWER_STRIKE.damage);
		expect(r.cooldowns[POWER_STRIKE.id]).toBe(POWER_STRIKE.cooldown);
	});

	test('attackT AND skill cooldowns both decay by dt', () => {
		const a = avatar({ attackT: 0.5 });
		const r = resolveCombat(
			a,
			{ [POWER_STRIKE.id]: 1.0, [GROUND_POUND.id]: 2.0 },
			1,
			'warrior',
			{ attack: false },
			0.2,
		);
		expect(r.attackT).toBeCloseTo(0.3, 5);
		expect(r.cooldowns[POWER_STRIKE.id]).toBeCloseTo(0.8, 5);
		expect(r.cooldowns[GROUND_POUND.id]).toBeCloseTo(1.8, 5);
	});

	test('a no-attack call still decays both timers and projects no hitbox', () => {
		const a = avatar({ attackT: 0.1 });
		const r = resolveCombat(
			a,
			{ [POWER_STRIKE.id]: 0.05 },
			1,
			'warrior',
			{ attack: false },
			0.2,
		);
		expect(r.hitbox).toBeNull();
		expect(r.attackT).toBe(0);
		expect(r.cooldowns[POWER_STRIKE.id]).toBe(0);
	});

	test('is pure — does not mutate the input cooldowns map', () => {
		const a = avatar({ attackT: 0 });
		const cds = { [POWER_STRIKE.id]: 0.5 };
		resolveCombat(a, cds, 1, 'warrior', { attack: true, skill: 1 }, 0.1);
		expect(cds[POWER_STRIKE.id]).toBe(0.5);
	});
});

describe('swing phase machine', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });

	test('attackT walks wind-up → active → recovery → idle as it counts down', () => {
		const { windup, active, recovery } = COMBAT.swing;
		// attackT = time REMAINING; elapsed = SWING_TOTAL - attackT.
		expect(swingPhase(SWING_TOTAL)).toBe('windup');
		expect(swingPhase(SWING_TOTAL - windup / 2)).toBe('windup');
		expect(swingPhase(SWING_TOTAL - windup - active / 2)).toBe('active');
		expect(swingPhase(SWING_TOTAL - windup - active - recovery / 2)).toBe(
			'recovery',
		);
		expect(swingPhase(0)).toBeNull();
		expect(swingPhase(-1)).toBeNull();
	});

	test('meleeActive is true exactly when the phase is active', () => {
		const { windup, active } = COMBAT.swing;
		expect(meleeActive(SWING_TOTAL)).toBe(false);
		expect(meleeActive(SWING_TOTAL - windup - active / 2)).toBe(true);
		expect(meleeActive(0.001)).toBe(false);
		expect(meleeActive(0)).toBe(false);
	});

	test('swingProgress runs 0→1 within each phase and is 0 when idle', () => {
		const { windup } = COMBAT.swing;
		expect(swingProgress(SWING_TOTAL)).toBeCloseTo(0, 5);
		expect(swingProgress(SWING_TOTAL - windup / 2)).toBeCloseTo(0.5, 5);
		expect(swingProgress(0)).toBe(0);
	});

	test('actionStateOf derives an idle action for a non-swinging entity', () => {
		expect(actionStateOf(avatar({ attackT: 0 }))).toEqual(IDLE_ACTION);
		expect(IDLE_ACTION.move).toBe('idle');
	});

	test('actionStateOf derives a basic move with the live phase + progress', () => {
		const { windup, active } = COMBAT.swing;
		const a = avatar({ attackT: SWING_TOTAL - windup - active / 2 });
		const action = actionStateOf(a);
		expect(action.move).toBe('basic');
		expect(action.phase).toBe('active');
		expect(action.progress).toBeCloseTo(0.5, 5);
		expect(action.flags).toBe(0);
	});
});

describe('swing pose realization', () => {
	test('swingPoseGlyph mirrors the diagonal with facing and keeps the level bar', () => {
		expect(swingPoseGlyph('windup', 1)).toBe('╲');
		expect(swingPoseGlyph('windup', -1)).toBe('╱');
		expect(swingPoseGlyph('recovery', 1)).toBe('╱');
		expect(swingPoseGlyph('recovery', -1)).toBe('╲');
		expect(swingPoseGlyph('active', 1)).toBe('─');
		expect(swingPoseGlyph('active', -1)).toBe('─');
	});

	test('swingPoseCell sits past the leading edge and drops through the swing', () => {
		const right = monster(20, 4, { type: 'player', facing: 1 });
		expect(swingPoseCell(right, 'windup')).toEqual({ x: 20 + BOX.w, y: 4 });
		expect(swingPoseCell(right, 'active')).toEqual({ x: 20 + BOX.w, y: 5 });
		expect(swingPoseCell(right, 'recovery')).toEqual({
			x: 20 + BOX.w,
			y: 4 + BOX.h - 1,
		});
		const left = monster(20, 4, { type: 'player', facing: -1 });
		expect(swingPoseCell(left, 'windup')).toEqual({ x: 19, y: 4 });
	});
});

describe('applyPoiseDamage', () => {
	test('chips the pool without breaking when the hit does not empty it', () => {
		const m = monster(0, 0, { poise: COMBAT.poise.max });
		const r = applyPoiseDamage(m, COMBAT.poiseDamage);
		expect(r.broke).toBe(false);
		expect(r.poise).toBe(COMBAT.poise.max - COMBAT.poiseDamage);
	});

	test('accumulates across hits and breaks only when the pool empties', () => {
		const hitsToBreak = Math.ceil(COMBAT.poise.max / COMBAT.poiseDamage);
		let poise: number = COMBAT.poise.max;
		let brokeAt = -1;
		for (let i = 1; i <= hitsToBreak; i++) {
			const r = applyPoiseDamage(monster(0, 0, { poise }), COMBAT.poiseDamage);
			if (r.broke && brokeAt < 0) brokeAt = i;
			poise = r.poise;
		}
		expect(brokeAt).toBe(hitsToBreak);
		expect(poise).toBe(COMBAT.poise.max); // a break refilled the pool
	});

	test('a low-poise-damage attacker never breaks a high-poise target', () => {
		let poise: number = COMBAT.poise.max;
		for (let i = 0; i < 10; i++) {
			const r = applyPoiseDamage(monster(0, 0, { poise }), 1);
			expect(r.broke).toBe(false);
			poise = r.poise;
		}
	});

	test('an absent pool defaults to full', () => {
		const r = applyPoiseDamage(monster(0, 0), COMBAT.poiseDamage);
		expect(r.poise).toBe(COMBAT.poise.max - COMBAT.poiseDamage);
		expect(r.broke).toBe(false);
	});

	test('a high-poise entity refills to its OWN poiseMax on a break, not the default', () => {
		const brute = monster(0, 0, { type: 'brute', poiseMax: BRUTE.poiseMax });
		expect(BRUTE.poiseMax).toBeGreaterThan(COMBAT.poise.max);
		const chip = applyPoiseDamage(brute, COMBAT.poiseDamage);
		expect(chip.broke).toBe(false);
		expect(chip.poise).toBe(BRUTE.poiseMax - COMBAT.poiseDamage);
		const broken = applyPoiseDamage(
			monster(0, 0, { type: 'brute', poiseMax: BRUTE.poiseMax, poise: 1 }),
			COMBAT.poiseDamage,
		);
		expect(broken.broke).toBe(true);
		expect(broken.poise).toBe(BRUTE.poiseMax);
	});
});

describe('superArmorActive', () => {
	test('true while the entity is in its own attack wind-up, false otherwise', () => {
		expect(superArmorActive(monster(0, 0, { attackT: SWING_TOTAL }))).toBe(
			true,
		);
		const active = SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
		expect(superArmorActive(monster(0, 0, { attackT: active }))).toBe(false);
		expect(superArmorActive(monster(0, 0, { attackT: 0 }))).toBe(false);
	});

	test('wind-up super-armor chips poise but suppresses the break (heavy swing not interrupted)', () => {
		const heavy = monster(0, 0, { poise: 4, attackT: SWING_TOTAL });
		const r = applyPoiseDamage(heavy, COMBAT.poiseDamage);
		expect(r.broke).toBe(false);
		expect(r.poise).toBe(0); // chipped to empty, not refilled — break suppressed
	});
});

describe('regenPoise', () => {
	test('regenerates toward the max and clamps at it', () => {
		expect(regenPoise(monster(0, 0, { poise: 10 }), 0.1)).toBeCloseTo(
			10 + COMBAT.poise.regen * 0.1,
		);
		expect(regenPoise(monster(0, 0, { poise: COMBAT.poise.max }), 10)).toBe(
			COMBAT.poise.max,
		);
	});

	test('a high-poise entity regenerates and clamps to its OWN max, above the default', () => {
		const brute = { type: 'brute' as const, poiseMax: BRUTE.poiseMax };
		expect(
			regenPoise(monster(0, 0, { ...brute, poise: BRUTE.poiseMax - 1 }), 10),
		).toBe(BRUTE.poiseMax);
		expect(
			regenPoise(monster(0, 0, { ...brute, poise: COMBAT.poise.max + 4 }), 0),
		).toBe(COMBAT.poise.max + 4);
	});
});

describe('actionFlags', () => {
	test('sets the staggered bit only while hitstun is in flight', () => {
		expect(actionFlags(monster(0, 0, { stunT: 0.2 }))).toBe(
			ACTION_FLAG.staggered,
		);
		expect(actionFlags(monster(0, 0, { stunT: 0 }))).toBe(0);
		expect(actionFlags(monster(0, 0))).toBe(0);
	});

	test('actionStateOf surfaces the staggered flag (idle or mid-swing)', () => {
		expect(actionStateOf(monster(0, 0, { stunT: 0.2 })).flags).toBe(
			ACTION_FLAG.staggered,
		);
		const swinging = monster(0, 0, { attackT: SWING_TOTAL, stunT: 0.2 });
		expect(actionStateOf(swinging).flags).toBe(ACTION_FLAG.staggered);
	});
});

describe('resolveCombat swingStarted', () => {
	test('true on the tick a fresh swing begins, false while one is in flight', () => {
		const idle = monster(20, 0, { type: 'player', attackT: 0 });
		const fresh = resolveCombat(
			idle,
			{},
			1,
			'warrior',
			{ attack: true },
			0.016,
		);
		expect(fresh.swingStarted).toBe(true);
		const mid = monster(20, 0, { type: 'player', attackT: fresh.attackT });
		const cont = resolveCombat(mid, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(cont.swingStarted).toBe(false);
	});
});

describe('stepAvatarCombat', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });
	const ctx = (over: Partial<Parameters<typeof stepAvatarCombat>[2]> = {}) => ({
		level: PROGRESSION.levelCap,
		cls: 'warrior' as const,
		weapon: weaponById(undefined),
		dt: 0.016,
		...over,
	});

	test('a fresh swing loads the phase sequence and RESETS swingHits', () => {
		const a = avatar({ attackT: 0, swingHits: [7, 9] });
		const r = stepAvatarCombat(a, { attack: true }, ctx());
		expect(r.avatar.attackT).toBe(SWING_TOTAL);
		expect(swingPhase(r.avatar.attackT)).toBe('windup');
		expect(r.avatar.swingHits).toEqual([]);
	});

	test('an in-flight swing KEEPS its swingHits so it lands once per target', () => {
		const a = avatar({ attackT: 0.1, swingHits: [7, 9] });
		const r = stepAvatarCombat(a, { attack: true }, ctx({ dt: 0.02 }));
		expect(r.avatar.swingHits).toEqual([7, 9]);
	});

	test('a live active swing projects ONE player-faction melee Strike; recovery projects none', () => {
		const { windup, active } = COMBAT.swing;
		const inActive = SWING_TOTAL - (windup + active / 2);
		const live = stepAvatarCombat(
			avatar({ id: 42, attackT: inActive }),
			{ attack: false },
			ctx({ dt: 0 }),
		);
		expect(swingPhase(live.avatar.attackT)).toBe('active');
		expect(live.strikes).toHaveLength(1);
		const s = live.strikes[0];
		expect(s.hitbox).toEqual(meleeHitbox(avatar()));
		expect(s.damage).toBe(COMBAT.meleeDamage);
		expect(s.attackerId).toBe(42);
		expect(s.attackerKind).toBe('avatar');
		expect(s.faction).toBe('players');
		expect(s.facing).toBe(1);
		expect(s.poiseDamage).toBe(COMBAT.poiseDamage);

		const inRecovery = SWING_TOTAL - (windup + active + 0.01);
		const dead = stepAvatarCombat(
			avatar({ attackT: inRecovery }),
			{ attack: false },
			ctx({ dt: 0 }),
		);
		expect(swingPhase(dead.avatar.attackT)).toBe('recovery');
		expect(dead.strikes).toEqual([]);
	});

	test('the Dodge i-frame + cooldown timers fold deterministically on a fresh hop', () => {
		const r = stepAvatarCombat(
			avatar({ onGround: true, dodgeT: 0, dodgeCdT: 0 }),
			{ dodge: true },
			ctx(),
		);
		expect(r.avatar.dodgeT).toBe(DODGE_TOTAL);
		expect(r.avatar.dodgeCdT).toBe(DODGE_LOCKOUT);
	});

	test('the held-Guard timer accumulates while guarding', () => {
		const a = avatar({ attackT: 0, guardT: 0.1 });
		const r = stepAvatarCombat(a, { guard: true }, ctx({ dt: 0.02 }));
		expect(r.avatar.guardT).toBeCloseTo(0.12, 5);
	});

	test('skill cooldowns fold onto the Avatar: a fired skill arms its cooldown, others decay', () => {
		const a = avatar({
			attackT: 0,
			skillCooldowns: { [GROUND_POUND.id]: 2.0 },
		});
		const r = stepAvatarCombat(a, { attack: true, skill: 1 }, ctx({ dt: 0.1 }));
		expect(r.avatar.skillCooldowns?.[POWER_STRIKE.id]).toBe(
			POWER_STRIKE.cooldown,
		);
		expect(r.avatar.skillCooldowns?.[GROUND_POUND.id]).toBeCloseTo(1.9, 5);
	});

	test('is pure — mutates neither the input Avatar nor its cooldowns map', () => {
		const cds = { [POWER_STRIKE.id]: 0.5 };
		const a = avatar({
			attackT: 0,
			swingHits: [3],
			guardT: 0.1,
			skillCooldowns: cds,
		});
		const r = stepAvatarCombat(a, { attack: true, skill: 1 }, ctx());
		expect(a.attackT).toBe(0);
		expect(a.swingHits).toEqual([3]);
		expect(cds[POWER_STRIKE.id]).toBe(0.5);
		expect(r.avatar).not.toBe(a);
		expect(r.avatar.attackT).toBe(SWING_TOTAL);
		expect(r.avatar.skillCooldowns).not.toBe(cds);
	});
});

describe('dodge phase machine', () => {
	const { active, recovery } = COMBAT.dodge;
	const player = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });

	test('DODGE_TOTAL is the sum of the active + recovery windows', () => {
		expect(DODGE_TOTAL).toBeCloseTo(active + recovery, 9);
	});

	test('dodgePhase walks active → recovery → null by time remaining', () => {
		expect(dodgePhase(0)).toBeNull();
		expect(dodgePhase(DODGE_TOTAL)).toBe('active');
		expect(dodgePhase(DODGE_TOTAL - active + 0.001)).toBe('active');
		expect(dodgePhase(DODGE_TOTAL - active - 0.001)).toBe('recovery');
		expect(dodgePhase(0.0001)).toBe('recovery');
	});

	test('dodgeInvulnerable is true ONLY during the active window', () => {
		expect(dodgeInvulnerable(player({ dodgeT: DODGE_TOTAL }))).toBe(true);
		expect(dodgeInvulnerable(player({ dodgeT: recovery * 0.5 }))).toBe(false);
		expect(dodgeInvulnerable(player({ dodgeT: 0 }))).toBe(false);
	});

	test('dodgeProgress runs 0→1 within each phase', () => {
		expect(dodgeProgress(DODGE_TOTAL)).toBeCloseTo(0, 5);
		expect(dodgeProgress(recovery)).toBeCloseTo(0, 5);
		expect(dodgeProgress(0.0001)).toBeGreaterThan(0.9);
	});

	test('avatarHittable folds both i-frame sources (hurtT OR active Dodge)', () => {
		expect(avatarHittable(player({ hurtT: 0, dodgeT: 0 }))).toBe(true);
		expect(avatarHittable(player({ hurtT: 0.5 }))).toBe(false);
		expect(avatarHittable(player({ dodgeT: DODGE_TOTAL }))).toBe(false);
		expect(avatarHittable(player({ dodgeT: recovery * 0.5 }))).toBe(true);
	});
});

describe('canStartDodge', () => {
	const player = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, attackT: 0, ...over });

	test('a free, grounded Avatar can start a Dodge while moving', () => {
		expect(canStartDodge(player(), 1)).toBe(true);
		expect(canStartDodge(player(), -1)).toBe(true);
	});

	test('cannot dodge from a standstill — only while a direction is held', () => {
		expect(canStartDodge(player(), 0)).toBe(false);
	});

	test('cannot dodge mid-Dodge (committal), mid-swing, or while Staggered', () => {
		expect(canStartDodge(player({ dodgeT: 0.1 }), 1)).toBe(false);
		expect(canStartDodge(player({ attackT: 0.1 }), 1)).toBe(false);
		expect(canStartDodge(player({ stunT: 0.1 }), 1)).toBe(false);
	});

	test('cannot dodge while the post-recovery cooldown is still draining', () => {
		expect(canStartDodge(player({ dodgeT: 0, dodgeCdT: 0.5 }), 1)).toBe(false);
	});

	test('cannot dodge while airborne — the hop is a grounded move', () => {
		expect(canStartDodge(player({ onGround: false }), 1)).toBe(false);
	});

	test('dodgeReady is the timing half only — ignores grounded + moving', () => {
		expect(dodgeReady(player({ onGround: false }))).toBe(true);
		expect(dodgeReady(player({ dodgeCdT: 0.3 }))).toBe(false);
		expect(dodgeReady(player({ attackT: 0.1 }))).toBe(false);
	});
});

describe('resolveCombat dodge', () => {
	const player = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, attackT: 0, ...over });

	test('a gated dodge intent loads the full hop, arms the cooldown, flags dodgeStarted', () => {
		const r = resolveCombat(
			player(),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{ dodge: true },
			0.016,
		);
		expect(r.dodgeStarted).toBe(true);
		expect(r.dodgeT).toBe(DODGE_TOTAL);
		expect(dodgePhase(r.dodgeT)).toBe('active');
		expect(r.dodgeCdT).toBeCloseTo(DODGE_LOCKOUT, 9);
	});

	test('a dodge intent is refused while the cooldown is still draining', () => {
		const r = resolveCombat(
			player({ dodgeT: 0, dodgeCdT: 0.5 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{ dodge: true },
			0.016,
		);
		expect(r.dodgeStarted).toBe(false);
		expect(r.dodgeT).toBe(0);
	});

	test('dodgeCdT decays each tick and outlives dodgeT (the cooldown tail)', () => {
		const r = resolveCombat(
			player({ dodgeT: 0, dodgeCdT: 0.5 }),
			{},
			1,
			'warrior',
			{},
			0.02,
		);
		expect(r.dodgeStarted).toBe(false);
		expect(r.dodgeCdT).toBeCloseTo(0.48, 5);
	});

	test('a dodge in flight only decays — holding the key does not restart it', () => {
		const r = resolveCombat(
			player({ dodgeT: 0.2 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{ dodge: true },
			0.02,
		);
		expect(r.dodgeStarted).toBe(false);
		expect(r.dodgeT).toBeCloseTo(0.18, 5);
	});

	test('a swing cannot start on the tick a Dodge begins (mutually exclusive)', () => {
		const r = resolveCombat(
			player(),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{ attack: true, dodge: true },
			0.016,
		);
		expect(r.dodgeStarted).toBe(true);
		expect(r.swingStarted).toBe(false);
		expect(r.attackT).toBe(0);
	});

	test('cannot dodge mid-swing — the swing keeps running', () => {
		const r = resolveCombat(
			player({ attackT: 0.2 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{ dodge: true },
			0.016,
		);
		expect(r.dodgeStarted).toBe(false);
		expect(r.dodgeT).toBe(0);
	});
});

describe('dodge action-state + pose', () => {
	const player = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, attackT: 0, ...over });

	test('actionStateOf reports the dodge move + the dodging flag while hopping', () => {
		const a = actionStateOf(player({ dodgeT: DODGE_TOTAL }));
		expect(a.move).toBe('dodge');
		expect(a.phase).toBe('active');
		expect(a.flags & ACTION_FLAG.dodging).toBe(ACTION_FLAG.dodging);
	});

	test('a Dodge takes the move slot over a concurrent swing timer', () => {
		const a = actionStateOf(player({ dodgeT: DODGE_TOTAL, attackT: 0.1 }));
		expect(a.move).toBe('dodge');
	});

	test('actionFlags ORs staggered + dodging', () => {
		const f = actionFlags(player({ dodgeT: DODGE_TOTAL, stunT: 0.1 }));
		expect(f & ACTION_FLAG.dodging).toBe(ACTION_FLAG.dodging);
		expect(f & ACTION_FLAG.staggered).toBe(ACTION_FLAG.staggered);
	});
});

describe('resolveCombat with an equipped weapon (ADR 0024 — damage only)', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });
	const heavy: Weapon = { name: 'Test Cleaver', damage: 16 };

	test('a fresh swing loads the ONE shared phase total, whatever the weapon', () => {
		const r = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			1,
			'warrior',
			{ attack: true },
			0.016,
			heavy,
		);
		expect(r.attackT).toBe(SWING_TOTAL);
	});

	test('damage comes from the weapon; the hitbox stays the shared arc', () => {
		const inActive =
			SWING_TOTAL - (COMBAT.swing.windup + COMBAT.swing.active / 2);
		const r = resolveCombat(
			avatar({ attackT: inActive }),
			{},
			1,
			'warrior',
			{ attack: false },
			0,
			heavy,
		);
		expect(r.damage).toBe(heavy.damage);
		expect(r.hitbox).toEqual(meleeHitbox(avatar()));
		expect(r.hitbox?.w).toBe(COMBAT.meleeReach);
	});
});

describe('swingPose — the unarmed swing telegraph (pure fn of move, phase, facing)', () => {
	test('returns null for a non-basic (idle / future) move', () => {
		expect(swingPose('idle', 'windup', 1)).toBeNull();
	});

	test('the tip glyph is the one shared telegraph, oriented by facing', () => {
		expect(swingPose('basic', 'windup', 1)?.glyph).toBe('╱');
		expect(swingPose('basic', 'windup', -1)?.glyph).toBe('╲');
	});

	test('the slash-arc sweep is present ONLY during the active phase', () => {
		expect(swingPose('basic', 'windup', 1)?.arc).toBeNull();
		expect(swingPose('basic', 'active', 1)?.arc).not.toBeNull();
		expect(swingPose('basic', 'recovery', 1)?.arc).toBeNull();
	});
});

describe('weaponFrame — WeaponSprite frame selector (pure fn of move, phase)', () => {
	test('a non-attacking Avatar shows the idle hold frame', () => {
		expect(weaponFrame('idle', null)).toBe('idle');
		expect(weaponFrame('idle', 'recovery')).toBe('idle');
	});

	test('a basic swing selects its own per-phase frame', () => {
		expect(weaponFrame('basic', 'windup')).toBe('windup');
		expect(weaponFrame('basic', 'active')).toBe('active');
		expect(weaponFrame('basic', 'recovery')).toBe('recovery');
	});
});

describe('sweepIndex — active-sweep frame for a swingProgress (ADR 0018 §4)', () => {
	test('the boundary frames: first at progress 0, last at progress 1', () => {
		expect(sweepIndex(0, 3)).toBe(0);
		expect(sweepIndex(1, 3)).toBe(2);
	});

	test('progress is partitioned into len equal slices', () => {
		expect(sweepIndex(0.2, 3)).toBe(0);
		expect(sweepIndex(0.5, 3)).toBe(1);
		expect(sweepIndex(0.8, 3)).toBe(2);
	});

	test('the sweep is monotonic non-decreasing across progress', () => {
		let prev = -1;
		for (let p = 0; p <= 1.0001; p += 0.05) {
			const i = sweepIndex(p, 4);
			expect(i).toBeGreaterThanOrEqual(prev);
			expect(i).toBeLessThanOrEqual(3);
			prev = i;
		}
	});

	test('out-of-range progress clamps into the sweep, and a single/empty sweep is index 0', () => {
		expect(sweepIndex(-0.5, 3)).toBe(0);
		expect(sweepIndex(1.5, 3)).toBe(2);
		expect(sweepIndex(0.5, 1)).toBe(0);
		expect(sweepIndex(0.5, 0)).toBe(0);
	});
});

describe('bladeEdgeArc — blade-edge arc smear (ADR 0018 §5)', () => {
	test('returns a smear of curve cells that traces the tip top→bottom through the swing', () => {
		const start = bladeEdgeArc(0, 1);
		const end = bladeEdgeArc(1, 1);
		expect(start.length).toBeGreaterThan(0);
		expect(end.length).toBeGreaterThan(0);
		expect(start[0].dy).toBeLessThan(0);
		expect(end[0].dy).toBeGreaterThan(0);
		for (const c of bladeEdgeArc(0.5, 1))
			expect(['╲', '╱', '─']).toContain(c.glyph);
	});

	test('the tip advances forward and downward as the swing progresses', () => {
		let prevDy = Number.NEGATIVE_INFINITY;
		for (let p = 0; p <= 1.0001; p += 0.1) {
			const head = bladeEdgeArc(Math.min(1, p), 1)[0];
			expect(head.dy).toBeGreaterThanOrEqual(prevDy);
			expect(head.dx).toBeGreaterThan(0);
			prevDy = head.dy;
		}
	});

	test('facing mirrors the arc across the grip and flips the diagonal glyphs', () => {
		const right = bladeEdgeArc(0.5, 1);
		const left = bladeEdgeArc(0.5, -1);
		expect(left.length).toBe(right.length);
		for (let i = 0; i < right.length; i++) {
			expect(left[i].dx).toBe(-right[i].dx);
			expect(left[i].dy).toBe(right[i].dy);
			const flip: Record<string, string> = { '╲': '╱', '╱': '╲', '─': '─' };
			expect(left[i].glyph).toBe(flip[right[i].glyph]);
		}
	});

	test('progress clamps into range', () => {
		expect(bladeEdgeArc(-1, 1)).toEqual(bladeEdgeArc(0, 1));
		expect(bladeEdgeArc(2, 1)).toEqual(bladeEdgeArc(1, 1));
	});
});

describe('guardRaised', () => {
	test('not guarding (guardT 0) is false', () => {
		expect(guardRaised(0)).toBe(false);
	});
	test('any positive guardT is a raised Block', () => {
		expect(guardRaised(0.001)).toBe(true);
		expect(guardRaised(5)).toBe(true);
	});
});

describe('facingToward (frontal arc, ADR 0017 §5)', () => {
	const a = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', ...over });
	test('an attacker on the side the defender faces is frontal', () => {
		expect(facingToward(a({ facing: 1 }), 30)).toBe(true);
		expect(facingToward(a({ facing: -1 }), 10)).toBe(true);
	});
	test('an attacker behind the defender is NOT frontal', () => {
		expect(facingToward(a({ facing: 1 }), 10)).toBe(false);
		expect(facingToward(a({ facing: -1 }), 30)).toBe(false);
	});
	test('an attacker sharing the column is treated as frontal (defender favour)', () => {
		expect(facingToward(a({ facing: 1, x: 20 }), 20)).toBe(true);
	});
});

describe('resolveGuard', () => {
	const { blockChip, blockPoise } = COMBAT.guard;
	const defender = (over: Partial<Entity> = {}) =>
		monster(20, 4, {
			type: 'player',
			facing: 1,
			poise: COMBAT.poise.max,
			...over,
		});
	const attackerX = 26;

	test('no Guard raised → full damage', () => {
		const g = resolveGuard(defender({ guardT: 0 }), attackerX, 8);
		expect(g.result).toBe('none');
		expect(g.hpDamage).toBe(8);
	});

	test('a rear hit ignores Guard even mid-block (frontal-arc gating)', () => {
		const g = resolveGuard(defender({ guardT: 0.5 }), 10, 8);
		expect(g.result).toBe('none');
		expect(g.hpDamage).toBe(8);
	});

	test('Block: any raised frontal Guard chips HP and drains Poise', () => {
		const g = resolveGuard(defender({ guardT: 0.01 }), attackerX, 8);
		expect(g.result).toBe('block');
		expect(g.hpDamage).toBe(Math.ceil(8 * blockChip));
		expect(g.defenderPoise).toBe(COMBAT.poise.max - blockPoise);
		expect(g.guardBroke).toBe(false);
	});

	test('Block to a Poise break is a guard-break Stagger', () => {
		const g = resolveGuard(
			defender({ guardT: 0.5, poise: blockPoise - 1 }),
			attackerX,
			8,
		);
		expect(g.result).toBe('block');
		expect(g.guardBroke).toBe(true);
	});
});

describe('guard pose realization', () => {
	test('guardPoseGlyph is the solid Block brace', () => {
		expect(guardPoseGlyph()).toBe('┃');
	});
	test('guardPoseCell sits just past the leading edge, mirrored by facing', () => {
		expect(guardPoseCell(monster(20, 4, { facing: 1 })).x).toBe(20 + BOX.w);
		expect(guardPoseCell(monster(20, 4, { facing: -1 })).x).toBe(20 - 1);
	});
});

describe('actionFlags surfaces the Guard stance (ADR 0017 §5/§10)', () => {
	test('a raised Guard sets the guarding bit', () => {
		const guarding = actionFlags(monster(0, 0, { guardT: 0.01 }));
		expect(guarding & ACTION_FLAG.guarding).toBeTruthy();
	});
	test('not guarding sets no guard bit', () => {
		const f = actionFlags(monster(0, 0, { guardT: 0 }));
		expect(f & ACTION_FLAG.guarding).toBeFalsy();
	});
});

describe('resolveCombat threads the held Guard (ADR 0017 §5)', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });

	test('holding Guard accumulates guardT; releasing resets it to 0', () => {
		const raised = resolveCombat(
			avatar({ guardT: 0 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{
				attack: false,
				guard: true,
			},
			0.05,
		);
		expect(raised.guardT).toBeCloseTo(0.05, 5);
		const held = resolveCombat(
			avatar({ guardT: 0.05 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{
				attack: false,
				guard: true,
			},
			0.05,
		);
		expect(held.guardT).toBeCloseTo(0.1, 5);
		const released = resolveCombat(
			avatar({ guardT: 0.1 }),
			{},
			1,
			'warrior',
			{
				attack: false,
				guard: false,
			},
			0.05,
		);
		expect(released.guardT).toBe(0);
	});

	test('Guard and the basic swing are mutually exclusive', () => {
		const r = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{
				attack: true,
				guard: true,
			},
			0.016,
		);
		expect(r.attackT).toBe(0);
		expect(r.hitbox).toBeNull();
		expect(r.guardT).toBeGreaterThan(0);
	});

	test('Guard cannot rise mid-swing — guardT stays 0 until the swing recovers', () => {
		const r = resolveCombat(
			avatar({ attackT: 0.1 }),
			{},
			PROGRESSION.levelCap,
			'warrior',
			{
				attack: false,
				guard: true,
			},
			0.016,
		);
		expect(r.guardT).toBe(0);
	});
});

describe('swatEvent', () => {
	test('builds a swat at the shot itself (its position + id), keyed to its damage', () => {
		const pr = projectile({ id: 42, x: 27, y: 6, damage: 7 });
		const e = swatEvent(pr, -1);
		expect(e).toEqual({
			kind: 'swat',
			targetId: 42,
			x: 27,
			y: 6,
			dir: -1,
			intensity: 7,
		});
		expect(e).not.toHaveProperty('source');
	});
});
