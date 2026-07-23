import { expect, test } from 'bun:test';
import { type Entity, SCENE_COLORS } from '@mmo/core/entities';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import { monsterAuthorsAttackFrames, paintActor } from '@mmo/render/sprites';

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

function paintOf(e: Entity): string {
	const c = new Compositor(24, 16);
	paintActor(c, e, NO_CAM);
	return JSON.stringify(c.surface());
}

const pouncing = (
	phase: 'windup' | 'active' | 'recovery',
	over: Partial<Entity> = {},
): Partial<Entity> => ({
	action: { move: 'basic', phase, progress: 0.1, flags: 0, emote: null, emoteT: 0 },
	...over,
});

test('a pouncing slime shows its authored squash/airborne/wobble body frames', () => {
	const idle = paintOf(entity({ id: 1, type: 'slime' }));
	const seen = new Set([
		paintOf(entity({ id: 1, type: 'slime', ...pouncing('windup') })),
		paintOf(
			entity({ id: 1, type: 'slime', onGround: false, ...pouncing('active') }),
		),
		paintOf(entity({ id: 1, type: 'slime', ...pouncing('recovery') })),
	]);
	expect(seen.has(idle)).toBe(false);
	expect(seen.size).toBe(3);
});

test('a phase-bound telegraph samples its frames by phase progress', () => {
	const at = (progress: number) => {
		const e = entity({ id: 1, type: 'slime' });
		e.action = { move: 'basic', phase: 'windup', progress, flags: 0, emote: null, emoteT: 0 };
		return paintOf(e);
	};
	expect(at(0.95)).not.toBe(at(0.05));
});

test('a slime traversal hop has no airborne frames authored and falls back to idle', () => {
	expect(paintOf(entity({ id: 1, type: 'slime', onGround: false }))).toBe(
		paintOf(entity({ id: 1, type: 'slime' })),
	);
});

test('an idle-only monster renders exactly as today in every action state', () => {
	const idle = paintOf(entity({ id: 1, type: 'chaser' }));
	expect(paintOf(entity({ id: 1, type: 'chaser', ...pouncing('windup') }))).toBe(idle);
	expect(paintOf(entity({ id: 1, type: 'chaser', ...pouncing('active') }))).toBe(idle);
	expect(paintOf(entity({ id: 1, type: 'chaser', onGround: false }))).toBe(idle);
});

test('authoring attack frames suppresses the overlay glyph; idle-only monsters keep it', () => {
	expect(monsterAuthorsAttackFrames('slime')).toBe(true);
	expect(monsterAuthorsAttackFrames('chaser')).toBe(false);
	expect(monsterAuthorsAttackFrames('shooter')).toBe(false);
	expect(monsterAuthorsAttackFrames('brute')).toBe(false);
	expect(monsterAuthorsAttackFrames('player')).toBe(false);
});
