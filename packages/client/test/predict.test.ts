import { expect, test } from 'bun:test';
import { COMBAT, DEFAULT_WEAPON } from '@mmo/core/combat';
import { EMOTES, type Entity, type Input } from '@mmo/core/entities';
import { SPAWN } from '@mmo/core/world';
import {
	applyEmote,
	arriveInZone,
	predictSwingEvents,
	reconcileHealth,
	spawnPredicted,
	stepPrediction,
} from '../src/game/predict';
import { entity, flatTerrain } from './helpers';

const TERRAIN = flatTerrain(60, 24);
const DODGE_LEVEL = 4;
const FRAME_MS = 16;

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

// Feet flush on TERRAIN's ground top (row 22, body height 5): the old y=20
// embedded the body 3 rows into the floor, which only "worked" because the
// pre-sweep collision checked destination cells alone.
function grounded(over: Partial<Entity> = {}): Entity {
	return entity({
		id: 1,
		type: 'player',
		x: 10,
		y: 17,
		onGround: true,
		...over,
	});
}

function step(prev: Entity, inp: Partial<Input>, level = 1) {
	return stepPrediction(
		prev,
		{ ...IDLE, ...inp },
		{
			terrain: TERRAIN,
			level,
			dtMs: FRAME_MS,
		},
	);
}

test('spawnPredicted places the Avatar at the spawn point carrying the chosen weapon', () => {
	const a = spawnPredicted(DEFAULT_WEAPON);
	expect(a.x).toBe(SPAWN.x);
	expect(a.y).toBe(SPAWN.y);
	expect(a.weapon).toBe(DEFAULT_WEAPON);
});

test('a dodge at an unlocked level launches the Avatar along the input direction', () => {
	const before = grounded();
	const after = step(before, { moveX: 1, dodge: true }, DODGE_LEVEL);
	expect(after.dodging).toBe(true);
	expect(after.avatar.x).toBeGreaterThan(before.x);
});

test('a dodge below the unlock level is refused, and no impulse leaks into physics', () => {
	const before = grounded();
	const under = step(before, { moveX: 1, dodge: true }, DODGE_LEVEL - 1);
	const plain = step(before, { moveX: 1 }, DODGE_LEVEL - 1);
	expect(under.dodging).toBe(false);
	expect(under.avatar.x).toBe(plain.avatar.x);
});

test('a dodge cannot start mid-dodge', () => {
	const mid = grounded({ dodgeT: COMBAT.dodge.active });
	expect(step(mid, { moveX: 1, dodge: true }, DODGE_LEVEL).dodging).toBe(false);
});

// A swing only strikes once it crosses out of windup, several frames after the key.
function swingToStrike(a: Entity) {
	let cur = a;
	for (let i = 0; i < 60; i++) {
		const r = step(cur, { attack: true });
		if (r.hitbox) return r;
		cur = r.avatar;
	}
	throw new Error('the swing never reached its active phase');
}

test('a swing reports its hitbox and damage once it reaches the active phase', () => {
	const r = swingToStrike(grounded({ weapon: undefined }));
	expect(r.hitbox).not.toBeNull();
	expect(r.hitDamage).toBeGreaterThan(0);
});

test('the frame the attack key lands is still windup — no strike yet', () => {
	expect(
		step(grounded({ weapon: undefined }), { attack: true }).hitbox,
	).toBeNull();
});

test('an idle frame reports no strike', () => {
	const r = step(grounded(), {});
	expect(r.hitbox).toBeNull();
	expect(r.hitDamage).toBe(0);
});

test('reconcileHealth takes the server health and leaves position alone', () => {
	const predicted = grounded({ x: 42, hp: 20, maxHp: 20, hurtT: 0 });
	reconcileHealth(predicted, { hp: 5, maxHp: 30, hurtT: 0.4 });
	expect(predicted.hp).toBe(5);
	expect(predicted.maxHp).toBe(30);
	expect(predicted.hurtT).toBe(0.4);
	expect(predicted.x).toBe(42);
});

test('arriveInZone teleports to the arrival point and kills inherited velocity', () => {
	const a = arriveInZone(grounded({ vx: 9, vy: -4 }), { x: 3, y: 7 });
	expect([a.x, a.y]).toEqual([3, 7]);
	expect([a.vx, a.vy]).toEqual([0, 0]);
	expect(a.onGround).toBe(false);
});

test('a swing hits a monster once, and the same swing cannot hit it again', () => {
	const r = swingToStrike(grounded({ x: 10, facing: 1, weapon: undefined }));
	if (!r.hitbox) throw new Error('expected a strike');

	const monster = entity({
		id: 99,
		type: 'chaser',
		x: r.hitbox.x,
		y: r.hitbox.y,
	});
	const predicted = { ...r.avatar };

	const first = predictSwingEvents(predicted, r.hitbox, r.hitDamage, [monster]);
	expect(first.length).toBeGreaterThan(0);
	expect(predicted.swingHits).toContain(99);

	const second = predictSwingEvents(predicted, r.hitbox, r.hitDamage, [
		monster,
	]);
	expect(second).toEqual([]);
});

test('applyEmote stamps a known emote onto the Avatar', () => {
	const stamped = applyEmote(grounded(), EMOTES[0].id);
	expect(stamped.emoteId).toBe(EMOTES[0].id);
	expect(stamped.emoteT).toBeGreaterThan(0);
});

test('applyEmote leaves the Avatar untouched for an unknown emote', () => {
	const base = grounded();
	expect(applyEmote(base, 'not-an-emote')).toBe(base);
});
