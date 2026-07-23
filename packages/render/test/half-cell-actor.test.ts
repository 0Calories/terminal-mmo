import { expect, test } from 'bun:test';
import type { Entity } from '@mmo/core/entities';
import { Compositor } from '@mmo/render/compositor';
import { paintActor } from '@mmo/render/sprites';

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

function buddy(over: Partial<Entity> = {}): Entity {
	return entity({
		id: 1,
		type: 'player',
		weapon: 0,
		cosmetics: { hue: 0, hat: 'party-hat', nameplate: 0, form: 'buddy' },
		...over,
	});
}

function paint(e: Entity, cam: { x: number; y: number }): Compositor {
	const c = new Compositor(30, 18);
	paintActor(c, e, cam);
	return c;
}

function inkedCells(c: Compositor): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	const surface = c.surface();
	for (let y = 0; y < surface.length; y++)
		for (let x = 0; x < surface[y].length; x++)
			if (surface[y][x].char !== ' ') out.push([x, y]);
	return out;
}

/** A surface is `moved` a whole cell right of `base` when every base ink cell has
 *  an identical cell one column right in `moved`, and both have equal ink counts. */
function isWholeCellRight(base: Compositor, moved: Compositor): boolean {
	const b = inkedCells(base);
	const m = inkedCells(moved);
	if (b.length !== m.length) return false;
	return b.every(([x, y]) => {
		const cellB = base.cell(x, y);
		const cellM = moved.cell(x + 1, y);
		return (
			cellM.char === cellB.char &&
			cellM.fg[0] === cellB.fg[0] &&
			cellM.fg[1] === cellB.fg[1] &&
			cellM.fg[2] === cellB.fg[2]
		);
	});
}

test('a one-Pixel actor move shifts the Pixel art by a sub-cell, while a two-Pixel move equals one whole cell', () => {
	const base = paint(entity({ id: 1, type: 'chaser' }), { x: 0, y: 0 });
	const half = paint(entity({ id: 1, type: 'chaser', x: 6.5 }), { x: 0, y: 0 });
	const whole = paint(entity({ id: 1, type: 'chaser', x: 7 }), { x: 0, y: 0 });

	// Half-cell: the art moved but not onto the next whole cell.
	expect(inkedCells(half)).not.toEqual(inkedCells(base));
	expect(isWholeCellRight(base, half)).toBe(false);
	// Full cell: a clean one-column translation of the identical art.
	expect(isWholeCellRight(base, whole)).toBe(true);
});

test('a one-Pixel actor move on the y axis shifts by a sub-cell too', () => {
	const base = paint(entity({ id: 1, type: 'chaser' }), { x: 0, y: 0 });
	const half = paint(entity({ id: 1, type: 'chaser', y: 4.5 }), { x: 0, y: 0 });
	expect(inkedCells(half)).not.toEqual(inkedCells(base));
});

test('a stationary actor at a half-cell camera offset renders identically frame to frame — no shimmer', () => {
	const cam = { x: 3.5, y: 2.5 };
	const e = entity({ id: 1, type: 'chaser' });
	expect(paint(e, cam).surface()).toEqual(paint(e, cam).surface());
});

test('moving camera and actor by the same sub-cell delta keeps the on-screen render fixed (single combined-transform quantization)', () => {
	const still = paint(entity({ id: 1, type: 'chaser', x: 6 }), { x: 0, y: 0 });
	const tracked = paint(entity({ id: 1, type: 'chaser', x: 6.5 }), {
		x: 0.5,
		y: 0,
	});
	// (worldPos - cam) is unchanged, so the rounded Pixel origin is unchanged.
	expect(tracked.surface()).toEqual(still.surface());
});

test('form, weapon, and hat translate as one unit — a whole-cell move shifts the assembled actor together with no gaps', () => {
	const base = paint(buddy({ x: 6 }), { x: 0, y: 0 });
	const moved = paint(buddy({ x: 7 }), { x: 0, y: 0 });
	// The armed, hatted actor is more than a bare body...
	const bare = paint(entity({ id: 1, type: 'player', x: 6 }), { x: 0, y: 0 });
	expect(inkedCells(base).length).toBeGreaterThan(inkedCells(bare).length);
	// ...and every inked cell — body, weapon, and hat — translates as one column.
	expect(isWholeCellRight(base, moved)).toBe(true);
});

test('the assembled actor keeps every part when placed at a half-cell offset — no part is dropped or detached', () => {
	const base = paint(buddy({ x: 6 }), { x: 0, y: 0 });
	const half = paint(buddy({ x: 6.5 }), { x: 0, y: 0 });
	// A half-cell offset spreads Pixels across boundaries, so it never inks fewer
	// cells than the aligned frame; parts stay glued to the shared Pixel origin.
	expect(inkedCells(half).length).toBeGreaterThanOrEqual(
		inkedCells(base).length,
	);
	expect(half.surface()).not.toEqual(base.surface());
});
