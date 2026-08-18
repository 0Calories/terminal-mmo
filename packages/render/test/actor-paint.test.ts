import { describe, expect, test } from 'bun:test';
import { ACTION_FLAG, IDLE_ACTION } from '@mmo/core/combat';
import { type Entity, SCENE_COLORS } from '@mmo/core/entities';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import {
	heldLoopFrameIndex,
	monsterAuthorsAttackFrames,
	paintActor,
} from '@mmo/render/sprites';

const NO_CAM = { x: 0, y: 0 };
const HURT: RGBA = SCENE_COLORS.hurt;

function eq(a: RGBA, b: RGBA): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function entity(over: Partial<Entity> & Pick<Entity, 'id' | 'type'>): Entity {
	return {
		x: 6,
		y: 4,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

function inked(c: Compositor): number {
	return c
		.surface()
		.flat()
		.filter((cell) => cell.char !== ' ').length;
}

test('a hurt actor paints its body in the hurt tint', () => {
	const c = new Compositor(24, 12);
	paintActor(c, entity({ id: 1, type: 'chaser', hurtT: 0.5 }), NO_CAM);
	const hurtCells = c
		.surface()
		.flat()
		.filter((cell) => cell.char !== ' ' && eq(cell.fg, HURT));
	expect(hurtCells.length).toBeGreaterThan(0);
});

test('below the hurt threshold the body keeps its own ink, not the hurt tint', () => {
	const c = new Compositor(24, 12);
	paintActor(c, entity({ id: 1, type: 'chaser', hurtT: 0.2 }), NO_CAM);
	const hurtCells = c
		.surface()
		.flat()
		.filter((cell) => cell.char !== ' ' && eq(cell.fg, HURT));
	expect(hurtCells.length).toBe(0);
});

test('seating a weapon adds inked cells beyond the bare body', () => {
	const buddy = (weapon: number | undefined): Entity =>
		entity({
			id: 1,
			type: 'player',
			weapon,
			cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'buddy' },
		});

	const armed = new Compositor(24, 16);
	paintActor(armed, buddy(0), NO_CAM);

	const unarmed = new Compositor(24, 16);
	paintActor(unarmed, buddy(undefined), NO_CAM);

	expect(inked(armed)).toBeGreaterThan(inked(unarmed));
});

describe('shield compositing', () => {
	const buddy = (over: Partial<Entity> = {}): Entity =>
		entity({
			id: 1,
			type: 'player',
			cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'buddy' },
			...over,
		});

	const guarding: Partial<Entity> = {
		action: { ...IDLE_ACTION, flags: ACTION_FLAG.guarding },
	};

	function paint(e: Entity): string {
		const c = new Compositor(24, 16);
		paintActor(c, e, NO_CAM);
		return JSON.stringify(c.surface());
	}

	test('guarding with a shield equipped paints the block frame', () => {
		expect(paint(buddy({ offhand: 0, ...guarding }))).not.toBe(
			paint(buddy(guarding)),
		);
	});

	test('no offhand paints exactly the bare body and does not crash', () => {
		expect(paint(buddy({ offhand: undefined }))).toBe(paint(buddy()));
	});

	test('an unknown offhand id paints nothing rather than crashing', () => {
		expect(paint(buddy({ offhand: 999, ...guarding }))).toBe(
			paint(buddy(guarding)),
		);
	});
});

function paintOf(e: Entity): string {
	const c = new Compositor(24, 16);
	paintActor(c, e, NO_CAM);
	return JSON.stringify(c.surface());
}

const pouncing = (
	phase: 'windup' | 'active' | 'recovery',
	over: Partial<Entity> = {},
): Partial<Entity> => ({
	action: {
		move: 'basic',
		phase,
		progress: 0.1,
		flags: 0,
		emote: null,
		emoteT: 0,
	},
	...over,
});

test('a slime traversal hop has no airborne frames authored and falls back to idle', () => {
	expect(paintOf(entity({ id: 1, type: 'slime', onGround: false }))).toBe(
		paintOf(entity({ id: 1, type: 'slime' })),
	);
});

test('an idle-only monster renders exactly as today in every action state', () => {
	const idle = paintOf(entity({ id: 1, type: 'chaser' }));
	expect(
		paintOf(entity({ id: 1, type: 'chaser', ...pouncing('windup') })),
	).toBe(idle);
	expect(
		paintOf(entity({ id: 1, type: 'chaser', ...pouncing('active') })),
	).toBe(idle);
	expect(paintOf(entity({ id: 1, type: 'chaser', onGround: false }))).toBe(
		idle,
	);
});

test('authoring attack frames suppresses the overlay glyph; idle-only monsters keep it', () => {
	expect(monsterAuthorsAttackFrames('slime')).toBe(true);
	expect(monsterAuthorsAttackFrames('chaser')).toBe(false);
	expect(monsterAuthorsAttackFrames('shooter')).toBe(false);
	expect(monsterAuthorsAttackFrames('brute')).toBe(false);
	expect(monsterAuthorsAttackFrames('player')).toBe(false);
});

test('a held-state fps loop cycles with wall time; static block stays put', () => {
	const looped = { frames: [{}, {}, {}], fps: 4 };
	expect(heldLoopFrameIndex(looped, 0)).toBe(0);
	expect(heldLoopFrameIndex(looped, 250)).toBe(1);
	expect(heldLoopFrameIndex(looped, 500)).toBe(2);
	expect(heldLoopFrameIndex(looped, 750)).toBe(0);
	expect(heldLoopFrameIndex({ frames: [{}] }, 9999)).toBe(0);
	expect(heldLoopFrameIndex({ frames: [{}, {}] }, 9999)).toBe(0);
});
