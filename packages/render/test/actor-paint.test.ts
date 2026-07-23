import { expect, test } from 'bun:test';
import { type Entity, SCENE_COLORS } from '@mmo/core/entities';
import { Compositor, type RGBA } from '@mmo/render/compositor';
import { paintActor } from '@mmo/render/sprites';

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
