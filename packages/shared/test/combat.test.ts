import { describe, expect, test } from 'bun:test';
import {
	ACTION_FLAG,
	actionFlags,
	actionStateOf,
	applyPoiseDamage,
	BOX,
	bloodEffect,
	COMBAT,
	comboReaction,
	deathGoreEffect,
	type Entity,
	entityBox,
	entityTint,
	facingToward,
	GROUND_POUND,
	guardPhase,
	guardPoseCell,
	guardPoseGlyph,
	hurtBloodEffect,
	IDLE_ACTION,
	impactEffect,
	launchEffect,
	meleeActive,
	meleeHitbox,
	POWER_STRIKE,
	parryActive,
	parryEffect,
	predictHitEffects,
	regenPoise,
	resolveCombat,
	resolveGuard,
	SWING_TOTAL,
	selectMove,
	skillHitbox,
	superArmorActive,
	swingPhase,
	swingPose,
	swingPoseCell,
	swingPoseGlyph,
	swingProgress,
	WEAPONS,
	weaponById,
	weaponSwingTotal,
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

describe('bloodEffect', () => {
	test('bursts at the monster centre, biased along facing, scaled by damage', () => {
		const m = monster(10, 4);
		const e = bloodEffect(m, 1, 8);
		expect(e).toEqual({
			kind: 'blood',
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: 8,
			dir: 1,
		});
	});

	test('carries the attributing session as source when given', () => {
		const e = bloodEffect(monster(0, 0), -1, 5, 42);
		expect(e.dir).toBe(-1);
		expect(e.source).toBe(42);
	});
});

describe('hurtBloodEffect', () => {
	test('bursts at the Avatar centre, biased away from the source, scaled by damage', () => {
		const a = monster(10, 4);
		expect(hurtBloodEffect(a, 1, 6)).toEqual({
			kind: 'blood',
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: 6,
			dir: 1,
		});
	});

	test('carries a radial dir 0 when the direction is ambiguous', () => {
		expect(hurtBloodEffect(monster(0, 0), 0, 7).dir).toBe(0);
	});

	test('never attaches a source — hurt blood is server-sourced, delivered to the victim too', () => {
		expect(hurtBloodEffect(monster(0, 0), -1, 6).source).toBeUndefined();
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

	test('an Avatar takes its cosmetic hue, not the default body colour', () => {
		const a = monster(0, 0, {
			type: 'player',
			cosmetics: { hue: 3, hat: 0, nameplate: 0 },
		});
		expect(entityTint(a)).toEqual({ r: 90, g: 170, b: 255 }); // HUES[3] = blue
	});

	test('a stray cosmetic hue falls back to the default amber body', () => {
		const a = monster(0, 0, {
			type: 'player',
			cosmetics: { hue: 999, hat: 0, nameplate: 0 },
		});
		expect(entityTint(a)).toEqual({ r: 255, g: 150, b: 40 }); // HUES[0]
	});
});

describe('deathGoreEffect', () => {
	test('bursts radially (dir 0) at the entity centre, high intensity, tinted by the entity', () => {
		const m = monster(10, 4);
		const e = deathGoreEffect(m);
		expect(e).toEqual({
			kind: 'gore',
			x: 10 + BOX.w / 2,
			y: 4 + BOX.h / 2,
			intensity: COMBAT.deathBurstIntensity,
			dir: 0,
			tint: { r: 220, g: 90, b: 90 },
		});
	});

	test('reads visibly bigger than a chip hit — intensity above melee damage', () => {
		expect(COMBAT.deathBurstIntensity).toBeGreaterThan(COMBAT.meleeDamage);
	});

	test('carries no source — death gore is delivered to everyone in range', () => {
		expect(deathGoreEffect(monster(0, 0)).source).toBeUndefined();
	});
});

describe('predictHitEffects', () => {
	test('emits one blood Effect per overlapping, non-i-framed monster', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		// place a monster squarely inside the swing hitbox
		const target = monster(hb.x, hb.y, { id: 7 });
		const effects = predictHitEffects(hb, 1, 8, [target]);
		expect(effects).toHaveLength(1);
		expect(effects[0]).toEqual(bloodEffect(target, 1, 8));
	});

	test('skips monsters in i-frames (hurtT > 0)', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		const target = monster(hb.x, hb.y, { hurtT: 0.3 });
		expect(predictHitEffects(hb, 1, 8, [target])).toHaveLength(0);
	});

	test('skips monsters the hitbox does not overlap', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		const far = monster(hb.x + 100, hb.y);
		expect(predictHitEffects(hb, 1, 8, [far])).toHaveLength(0);
	});

	test('never attaches a source — predicted Effects are not reported upward', () => {
		const attacker = monster(0, 0, { facing: 1 });
		const hb = meleeHitbox(attacker);
		const target = monster(hb.x, hb.y);
		expect(predictHitEffects(hb, 1, 8, [target])[0].source).toBeUndefined();
		// sanity: the hitbox really does overlap the target
		expect(entityBox(target).x).toBeLessThan(hb.x + hb.w);
	});
});

describe('resolveCombat', () => {
	// An Avatar-shaped Entity (the monster() factory makes a generic Entity).
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });

	test('starting a basic swing loads the full phase sequence and is in wind-up (no hitbox yet)', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		// The swing commits this tick but the hitbox is NOT live during wind-up
		// (ADR 0017 §1) — it goes live a few ticks later, in the active phase.
		expect(r.attackT).toBe(SWING_TOTAL);
		expect(swingPhase(r.attackT)).toBe('windup');
		expect(r.hitbox).toBeNull();
		expect(r.skillFired).toBeUndefined();
	});

	test('the melee hitbox is live ONLY during the active phase', () => {
		const { windup, active } = COMBAT.swing;
		// Mid-active: attackT positioned so elapsed lands inside the active window.
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

		// Mid-recovery: past the active window — exposed, no hitbox.
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
		// Holding attack while in recovery must not re-trigger; the phase machine runs
		// to completion before a new swing can begin.
		const a = avatar({ attackT: 0.1 });
		const before = a.attackT;
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.02);
		expect(r.attackT).toBeCloseTo(before - 0.02, 5); // just decayed, not reset
		expect(r.attackT).toBeLessThan(SWING_TOTAL);
	});

	test('a new swing can start once the prior swing has fully recovered (idle)', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(r.attackT).toBe(SWING_TOTAL);
	});

	test('a skill is gated when level < unlockLevel', () => {
		const a = avatar({ attackT: 0 });
		// GROUND_POUND unlocks at level 5; slot 2 = GROUND_POUND.
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
		// the on-cooldown timer still decays
		expect(r.cooldowns[POWER_STRIKE.id]).toBeCloseTo(0.9, 5);
	});

	test('a fired skill overrides the basic swing', () => {
		const a = avatar({ attackT: 0 });
		const r = resolveCombat(
			a,
			{},
			1,
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
		expect(r.attackT).toBe(0); // clamped at 0
		expect(r.cooldowns[POWER_STRIKE.id]).toBe(0); // clamped at 0
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
		expect(swingPhase(SWING_TOTAL)).toBe('windup'); // elapsed 0
		expect(swingPhase(SWING_TOTAL - windup / 2)).toBe('windup');
		expect(swingPhase(SWING_TOTAL - windup - active / 2)).toBe('active');
		expect(swingPhase(SWING_TOTAL - windup - active - recovery / 2)).toBe(
			'recovery',
		);
		expect(swingPhase(0)).toBeNull(); // idle
		expect(swingPhase(-1)).toBeNull();
	});

	test('meleeActive is true exactly when the phase is active', () => {
		const { windup, active } = COMBAT.swing;
		expect(meleeActive(SWING_TOTAL)).toBe(false); // wind-up
		expect(meleeActive(SWING_TOTAL - windup - active / 2)).toBe(true); // active
		expect(meleeActive(0.001)).toBe(false); // recovery tail
		expect(meleeActive(0)).toBe(false); // idle
	});

	test('swingProgress runs 0→1 within each phase and is 0 when idle', () => {
		const { windup } = COMBAT.swing;
		expect(swingProgress(SWING_TOTAL)).toBeCloseTo(0, 5); // start of wind-up
		expect(swingProgress(SWING_TOTAL - windup / 2)).toBeCloseTo(0.5, 5);
		expect(swingProgress(0)).toBe(0); // idle
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
		expect(swingPoseGlyph('windup', -1)).toBe('╱'); // mirrored
		expect(swingPoseGlyph('recovery', 1)).toBe('╱');
		expect(swingPoseGlyph('recovery', -1)).toBe('╲'); // mirrored
		expect(swingPoseGlyph('active', 1)).toBe('─'); // symmetric
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
		// Facing left places the accent on the other side.
		const left = monster(20, 4, { type: 'player', facing: -1 });
		expect(swingPoseCell(left, 'windup')).toEqual({ x: 19, y: 4 });
	});
});

// --- Poise + hit-reaction (ADR 0017 §2/§3) ----------------------------------

describe('applyPoiseDamage', () => {
	test('chips the pool without breaking when the hit does not empty it', () => {
		const m = monster(0, 0, { poise: COMBAT.poise.max });
		const r = applyPoiseDamage(m, COMBAT.poiseDamage);
		expect(r.broke).toBe(false);
		expect(r.poise).toBe(COMBAT.poise.max - COMBAT.poiseDamage);
	});

	test('accumulates across hits and breaks only when the pool empties', () => {
		// Pure accumulation (no regen between hits): the pool depletes by poiseDamage
		// each connect and breaks exactly when the accumulated damage empties it.
		const hitsToBreak = Math.ceil(COMBAT.poise.max / COMBAT.poiseDamage);
		let poise: number = COMBAT.poise.max;
		let brokeAt = -1;
		for (let i = 1; i <= hitsToBreak; i++) {
			const r = applyPoiseDamage(monster(0, 0, { poise }), COMBAT.poiseDamage);
			if (r.broke && brokeAt < 0) brokeAt = i;
			poise = r.poise;
		}
		expect(brokeAt).toBe(hitsToBreak); // earlier hits chip; only the last one breaks
		expect(poise).toBe(COMBAT.poise.max); // a break refilled the pool
	});

	test('a low-poise-damage attacker never breaks a high-poise target', () => {
		// A trivial 1-poise chip against a full pool: many hits, never a break.
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
});

describe('superArmorActive', () => {
	test('true while the entity is in its own attack wind-up, false otherwise', () => {
		expect(superArmorActive(monster(0, 0, { attackT: SWING_TOTAL }))).toBe(
			true,
		);
		// Mid-active (past wind-up) and idle both lack super-armor.
		const active = SWING_TOTAL - COMBAT.swing.windup - COMBAT.swing.active / 2;
		expect(superArmorActive(monster(0, 0, { attackT: active }))).toBe(false);
		expect(superArmorActive(monster(0, 0, { attackT: 0 }))).toBe(false);
	});

	test('wind-up super-armor chips poise but suppresses the break (heavy swing not interrupted)', () => {
		// A nearly-empty pool that WOULD break, but the entity is mid-wind-up: the hit
		// chips it to 0 without staggering, so the committed heavy swing survives.
		const heavy = monster(0, 0, { poise: 4, attackT: SWING_TOTAL });
		const r = applyPoiseDamage(heavy, COMBAT.poiseDamage);
		expect(r.broke).toBe(false);
		expect(r.poise).toBe(0); // chipped to empty, not refilled — next hit out of wind-up breaks
	});
});

describe('regenPoise', () => {
	test('regenerates toward the max and clamps at it', () => {
		expect(regenPoise(monster(0, 0, { poise: 10 }), 0.1)).toBeCloseTo(
			10 + COMBAT.poise.regen * 0.1,
		);
		// Already full stays full; a large dt cannot overshoot the cap.
		expect(regenPoise(monster(0, 0, { poise: COMBAT.poise.max }), 10)).toBe(
			COMBAT.poise.max,
		);
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

describe('impactEffect', () => {
	test('bursts at the victim centre, biased along facing, bigger than a chip, no source', () => {
		const m = monster(10, 4);
		const e = impactEffect(m, 1, COMBAT.meleeDamage);
		expect(e.kind).toBe('impact');
		expect(e.x).toBe(10 + BOX.w / 2);
		expect(e.y).toBe(4 + BOX.h / 2);
		expect(e.dir).toBe(1);
		expect(e.intensity).toBeGreaterThan(COMBAT.meleeDamage); // meatier than chip blood
		expect(e.source).toBeUndefined(); // delivered to everyone, like the death burst
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
		// Still mid-swing on the next tick: holding attack does not restart it.
		const mid = monster(20, 0, { type: 'player', attackT: fresh.attackT });
		const cont = resolveCombat(mid, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(cont.swingStarted).toBe(false);
	});
});

describe('resolveCombat with a weapon stat block', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });
	const great = weaponById(WEAPONS.findIndex((w) => w.name === 'Greatsword'));
	const dagger = weaponById(WEAPONS.findIndex((w) => w.name === 'Dagger'));

	test('a fresh swing loads the WEAPON phase total, not the default', () => {
		const r = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			1,
			'warrior',
			{ attack: true },
			0.016,
			great,
		);
		expect(r.attackT).toBe(weaponSwingTotal(great));
	});

	test('damage and hitbox reach come from the weapon, not the constants', () => {
		// Position attackT inside the greatsword's own active window.
		const inActive =
			weaponSwingTotal(great) - (great.swing.windup + great.swing.active / 2);
		const r = resolveCombat(
			avatar({ attackT: inActive }),
			{},
			1,
			'warrior',
			{ attack: false },
			0,
			great,
		);
		expect(r.damage).toBe(great.damage);
		expect(r.hitbox).toEqual(meleeHitbox(avatar(), great.reach));
		expect(r.hitbox?.w).toBe(great.reach);
	});

	test('two weapons produce measurably different phase timing from data alone', () => {
		const swing = (w: typeof great) =>
			resolveCombat(
				avatar({ attackT: 0 }),
				{},
				1,
				'warrior',
				{ attack: true },
				0.016,
				w,
			).attackT;
		expect(swing(great)).toBeGreaterThan(swing(dagger));
	});
});

describe('swingPose — composited weapon visual (pure fn of move, phase, weapon)', () => {
	const sword = weaponById(0);
	const great = weaponById(WEAPONS.findIndex((w) => w.name === 'Greatsword'));

	test('returns null for a non-basic (idle / future) move', () => {
		expect(swingPose('idle', 'windup', sword, 1)).toBeNull();
	});

	test('the accent glyph is the weapon glyph, oriented by facing', () => {
		expect(swingPose('basic', 'windup', sword, 1)?.glyph).toBe(sword.glyph);
		// facing -1 mirrors the diagonal (╱ → ╲)
		expect(swingPose('basic', 'windup', sword, -1)?.glyph).toBe('╲');
	});

	test('different weapons composite different glyphs from data alone', () => {
		expect(swingPose('basic', 'active', great, 1)?.glyph).toBe(great.glyph);
		expect(swingPose('basic', 'active', great, 1)?.glyph).not.toBe(sword.glyph);
	});

	test('the slash-arc sweep is present ONLY during the active phase', () => {
		expect(swingPose('basic', 'windup', sword, 1)?.arc).toBeNull();
		expect(swingPose('basic', 'active', sword, 1)?.arc).not.toBeNull();
		expect(swingPose('basic', 'recovery', sword, 1)?.arc).toBeNull();
	});
});

// --- Guard: Block + Parry (ADR 0017 §5) -------------------------------------

describe('guardPhase', () => {
	const { parryWindow } = COMBAT.guard;
	test('not guarding (guardT 0) reads null', () => {
		expect(guardPhase(0)).toBeNull();
	});
	test('the opening window of a raise is the Parry', () => {
		expect(guardPhase(0.001)).toBe('parry');
		expect(guardPhase(parryWindow)).toBe('parry');
	});
	test('held past the opening window is a Block', () => {
		expect(guardPhase(parryWindow + 0.001)).toBe('block');
		expect(guardPhase(5)).toBe('block'); // still blocking after holding indefinitely
	});
});

describe('parryActive (lag compensation, ADR 0017 §11)', () => {
	const { parryWindow, lagComp } = COMBAT.guard;
	test('within the raw window with no lag is a Parry; past it is not', () => {
		expect(parryActive(parryWindow)).toBe(true);
		expect(parryActive(parryWindow + 0.001)).toBe(false);
	});
	test('lag slack widens the Parry window so a slightly-late catch still parries', () => {
		const late = parryWindow + lagComp / 2; // would read as Block with no comp
		expect(parryActive(late, 0)).toBe(false);
		expect(parryActive(late, lagComp)).toBe(true);
	});
	test('the slack is clamped to lagComp — an absurd timestamp cannot widen it forever', () => {
		const tooLate = parryWindow + lagComp + 0.05;
		expect(parryActive(tooLate, 999)).toBe(false);
	});
});

describe('facingToward (frontal arc, ADR 0017 §5)', () => {
	const a = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', ...over });
	test('an attacker on the side the defender faces is frontal', () => {
		expect(facingToward(a({ facing: 1 }), 30)).toBe(true); // facing right, attacker right
		expect(facingToward(a({ facing: -1 }), 10)).toBe(true); // facing left, attacker left
	});
	test('an attacker behind the defender is NOT frontal', () => {
		expect(facingToward(a({ facing: 1 }), 10)).toBe(false); // facing right, attacker left
		expect(facingToward(a({ facing: -1 }), 30)).toBe(false);
	});
	test('an attacker sharing the column is treated as frontal (defender favour)', () => {
		expect(facingToward(a({ facing: 1, x: 20 }), 20)).toBe(true);
	});
});

describe('resolveGuard', () => {
	const { parryWindow, blockChip, blockPoise, parryPoiseDamage } = COMBAT.guard;
	// A defender facing right (+1) with an attacker to the right (frontal).
	const defender = (over: Partial<Entity> = {}) =>
		monster(20, 4, {
			type: 'player',
			facing: 1,
			poise: COMBAT.poise.max,
			...over,
		});
	const attackerX = 26;

	test('no Guard raised → full damage, no attacker dump', () => {
		const g = resolveGuard(defender({ guardT: 0 }), attackerX, 8);
		expect(g.result).toBe('none');
		expect(g.hpDamage).toBe(8);
		expect(g.attackerPoiseDump).toBe(0);
	});

	test('a rear hit ignores Guard even mid-block (frontal-arc gating)', () => {
		// Guard up and blocking, but the attacker is BEHIND (to the left of a right-facer).
		const g = resolveGuard(defender({ guardT: parryWindow + 0.1 }), 10, 8);
		expect(g.result).toBe('none');
		expect(g.hpDamage).toBe(8);
	});

	test('Block: frontal hit chips HP and drains Poise', () => {
		const g = resolveGuard(
			defender({ guardT: parryWindow + 0.1 }),
			attackerX,
			8,
		);
		expect(g.result).toBe('block');
		expect(g.hpDamage).toBe(Math.ceil(8 * blockChip));
		expect(g.defenderPoise).toBe(COMBAT.poise.max - blockPoise);
		expect(g.guardBroke).toBe(false);
		expect(g.attackerPoiseDump).toBe(0);
	});

	test('Block to a Poise break is a guard-break Stagger', () => {
		// A nearly-empty pool: one block drains it past 0 → break.
		const g = resolveGuard(
			defender({ guardT: parryWindow + 0.1, poise: blockPoise - 1 }),
			attackerX,
			8,
		);
		expect(g.result).toBe('block');
		expect(g.guardBroke).toBe(true);
	});

	test('Parry: a frontal hit in the opening window negates damage + dumps Poise on the attacker', () => {
		const g = resolveGuard(defender({ guardT: parryWindow }), attackerX, 8);
		expect(g.result).toBe('parry');
		expect(g.hpDamage).toBe(0);
		expect(g.attackerPoiseDump).toBe(parryPoiseDamage);
		expect(g.guardBroke).toBe(false);
	});

	test('lag-comp resolves a Parry that was valid on the client timeline (ADR 0017 §11)', () => {
		// A catch a hair past the raw window — a Block with no comp, a Parry once the
		// input's staleness (its client timestamp) extends the window.
		const late = parryWindow + COMBAT.guard.lagComp / 2;
		expect(resolveGuard(defender({ guardT: late }), attackerX, 8).result).toBe(
			'block',
		);
		expect(
			resolveGuard(
				defender({ guardT: late }),
				attackerX,
				8,
				COMBAT.guard.lagComp,
			).result,
		).toBe('parry');
	});
});

describe('parryEffect', () => {
	test('a source-less clash flash at the defender, fixed intensity (damage is negated)', () => {
		const d = monster(20, 4, { type: 'player' });
		const e = parryEffect(d, 1);
		expect(e.kind).toBe('parry');
		expect(e.x).toBe(20 + BOX.w / 2);
		expect(e.source).toBeUndefined();
		expect(e.intensity).toBe(COMBAT.poise.max);
	});
});

describe('guard pose realization', () => {
	test('the Parry window flashes a brighter sigil than a Block brace', () => {
		expect(guardPoseGlyph('parry')).not.toBe(guardPoseGlyph('block'));
	});
	test('guardPoseCell sits just past the leading edge, mirrored by facing', () => {
		expect(guardPoseCell(monster(20, 4, { facing: 1 })).x).toBe(20 + BOX.w);
		expect(guardPoseCell(monster(20, 4, { facing: -1 })).x).toBe(20 - 1);
	});
});

describe('actionFlags surfaces the Guard stance (ADR 0017 §5/§10)', () => {
	test('a raised Guard sets the guarding bit; its opening also sets parrying', () => {
		const parrying = actionFlags(monster(0, 0, { guardT: 0.01 }));
		expect(parrying & ACTION_FLAG.guarding).toBeTruthy();
		expect(parrying & ACTION_FLAG.parrying).toBeTruthy();
		const blocking = actionFlags(
			monster(0, 0, { guardT: COMBAT.guard.parryWindow + 0.1 }),
		);
		expect(blocking & ACTION_FLAG.guarding).toBeTruthy();
		expect(blocking & ACTION_FLAG.parrying).toBeFalsy();
	});
	test('not guarding sets neither bit', () => {
		const f = actionFlags(monster(0, 0, { guardT: 0 }));
		expect(f & ACTION_FLAG.guarding).toBeFalsy();
		expect(f & ACTION_FLAG.parrying).toBeFalsy();
	});
});

describe('resolveCombat threads the held Guard (ADR 0017 §5)', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });

	test('holding Guard accumulates guardT; releasing resets it to 0', () => {
		const raised = resolveCombat(
			avatar({ guardT: 0 }),
			{},
			1,
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
			1,
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
		// Pressing attack + guard the same tick raises Guard, no swing starts.
		const r = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			1,
			'warrior',
			{
				attack: true,
				guard: true,
			},
			0.016,
		);
		expect(r.attackT).toBe(0); // no swing
		expect(r.hitbox).toBeNull();
		expect(r.guardT).toBeGreaterThan(0); // guard raised instead
	});

	test('Guard cannot rise mid-swing — guardT stays 0 until the swing recovers', () => {
		const r = resolveCombat(
			avatar({ attackT: 0.1 }),
			{},
			1,
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

// --- Combo substrate (ADR 0017 §6) ------------------------------------------

describe('selectMove — vertical move selection', () => {
	test('up+attack is a Launcher, on the ground or in the air', () => {
		expect(selectMove({ up: true }, true)).toBe('launch');
		expect(selectMove({ up: true }, false)).toBe('launch');
	});

	test('airborne down+attack is a Spike; grounded down is just a basic swing', () => {
		expect(selectMove({ down: true }, false)).toBe('spike');
		// `down` on the ground is the reserved crouch/drop verb, not a Spike.
		expect(selectMove({ down: true }, true)).toBe('basic');
	});

	test('a plain air swing keeps a target aloft (aerial); a plain ground swing is basic', () => {
		expect(selectMove({}, false)).toBe('aerial');
		expect(selectMove({}, true)).toBe('basic');
	});

	test('up wins over down when both are held', () => {
		expect(selectMove({ up: true, down: true }, false)).toBe('launch');
	});
});

describe('comboReaction — combo decay bounds a juggle', () => {
	const base = COMBAT.hitstun;
	const lift = COMBAT.launchUp;

	test('the first hit (n=0) is full Hitstun + full lift', () => {
		const r = comboReaction(base, lift, 0);
		expect(r.hitstun).toBeCloseTo(base, 5);
		expect(r.lift).toBeCloseTo(lift, 5);
		expect(r.terminal).toBe(false);
	});

	test('each successive hit decays both Hitstun and lift', () => {
		const a = comboReaction(base, lift, 1);
		const b = comboReaction(base, lift, 2);
		expect(a.hitstun).toBeLessThan(base);
		expect(b.hitstun).toBeLessThan(a.hitstun);
		expect(b.lift).toBeLessThan(a.lift);
	});

	test('Hitstun never decays below the floor', () => {
		const r = comboReaction(base, lift, COMBAT.combo.maxHits - 1);
		expect(r.hitstun).toBeGreaterThanOrEqual(COMBAT.combo.minHitstun);
	});

	test('at the hit cap the reaction is terminal — no stun, no lift', () => {
		const r = comboReaction(base, lift, COMBAT.combo.maxHits);
		expect(r.terminal).toBe(true);
		expect(r.hitstun).toBe(0);
		expect(r.lift).toBe(0);
	});
});

describe('resolveCombat — cancel-on-connect (ADR 0017 §6)', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, ...over });
	// An attackT positioned inside the recovery phase.
	const inRecovery =
		SWING_TOTAL - (COMBAT.swing.windup + COMBAT.swing.active + 0.01);

	test('a CONNECTED swing can cancel its recovery into a fresh swing', () => {
		// swingHits non-empty = the swing has hit a target.
		const a = avatar({ attackT: inRecovery, swingHits: [99] });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(r.swingStarted).toBe(true);
		expect(r.attackT).toBe(SWING_TOTAL); // a brand new swing loaded
	});

	test('a WHIFFED swing (no hits) stays fully committal — no cancel', () => {
		const a = avatar({ attackT: inRecovery, swingHits: [] });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(r.swingStarted).toBe(false);
		expect(r.attackT).toBeCloseTo(inRecovery - 0.016, 5); // just decayed, not reset
	});

	test('cancel is gated to recovery — a connected swing in wind-up/active cannot cancel', () => {
		const inWindup = SWING_TOTAL - COMBAT.swing.windup / 2;
		const a = avatar({ attackT: inWindup, swingHits: [99] });
		const r = resolveCombat(a, {}, 1, 'warrior', { attack: true }, 0.016);
		expect(r.swingStarted).toBe(false);
	});
});

describe('resolveCombat — move variant + attacker pop (ADR 0017 §6)', () => {
	const avatar = (over: Partial<Entity> = {}) =>
		monster(20, 4, { type: 'player', facing: 1, onGround: true, ...over });

	test('a fresh up+attack starts a launch swing and pops the grounded attacker up', () => {
		const r = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			1,
			'warrior',
			{ attack: true, up: true },
			0.016,
		);
		expect(r.attackMove).toBe('launch');
		expect(r.attackerPop).toBe(COMBAT.launchPop);
	});

	test('a launch in the AIR does not pop the attacker (no double-jump)', () => {
		const r = resolveCombat(
			avatar({ attackT: 0, onGround: false }),
			{},
			1,
			'warrior',
			{ attack: true, up: true },
			0.016,
		);
		expect(r.attackMove).toBe('launch');
		expect(r.attackerPop).toBe(0);
	});

	test('a basic swing pops nothing and the move is held while the swing runs', () => {
		const start = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			1,
			'warrior',
			{ attack: true },
			0.016,
		);
		expect(start.attackMove).toBe('basic');
		expect(start.attackerPop).toBe(0);
		// Mid-swing the variant is held off the Entity, even with no modifier this tick.
		const mid = resolveCombat(
			avatar({ attackT: start.attackT, attackMove: 'launch' }),
			{},
			1,
			'warrior',
			{ attack: false },
			0.016,
		);
		expect(mid.attackMove).toBe('launch');
	});

	test('an idle entity reports the idle move', () => {
		const r = resolveCombat(
			avatar({ attackT: 0 }),
			{},
			1,
			'warrior',
			{ attack: false },
			0.016,
		);
		expect(r.attackMove).toBe('idle');
	});
});

describe('actionStateOf reflects the swing variant', () => {
	test('a launch swing replicates as move "launch", not "basic"', () => {
		const inActive =
			SWING_TOTAL - (COMBAT.swing.windup + COMBAT.swing.active / 2);
		const e = monster(0, 0, {
			type: 'player',
			attackT: inActive,
			attackMove: 'launch',
		});
		expect(actionStateOf(e).move).toBe('launch');
	});
});

describe('launchEffect', () => {
	test('is a source-less, radial (dir 0) launch burst at the target centre', () => {
		const m = monster(10, 6);
		const fx = launchEffect(m, COMBAT.meleeDamage);
		expect(fx.kind).toBe('launch');
		expect(fx.dir).toBe(0);
		expect(fx.source).toBeUndefined();
		expect(fx.x).toBeCloseTo(10 + BOX.w / 2, 5);
		expect(fx.intensity).toBeGreaterThan(COMBAT.meleeDamage);
	});
});

describe('per-entity poise ceiling (poise-tank gating)', () => {
	test('a large poiseMax resists a break that would shatter a default pool', () => {
		// One Sword hit (poiseDamage 8) breaks a near-empty default pool…
		const weak = monster(0, 0, { poise: 8 });
		expect(applyPoiseDamage(weak, COMBAT.poiseDamage).broke).toBe(true);
		// …but the same hit barely dents a tank's large full pool.
		const tank = monster(0, 0, { poiseMax: 40, poise: 40 });
		const r = applyPoiseDamage(tank, COMBAT.poiseDamage);
		expect(r.broke).toBe(false);
		expect(r.poise).toBe(40 - COMBAT.poiseDamage);
	});
});
