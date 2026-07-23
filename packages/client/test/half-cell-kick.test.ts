import { expect, test } from 'bun:test';
import type { Entity } from '@mmo/core/entities';
import { Compositor } from '@mmo/render/compositor';
import { paintActor } from '@mmo/render/sprites';
import {
	applyKick,
	CAMERA_KICK,
	NO_KICK,
	stepKick,
} from '../src/render/camera';

function chaser(): Entity {
	return {
		id: 1,
		type: 'chaser',
		x: 8,
		y: 6,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		hurtT: 0,
		attackT: 0,
	};
}

function paintAt(camX: number): string {
	const c = new Compositor(30, 18);
	paintActor(c, chaser(), { x: camX, y: 0 });
	return JSON.stringify(c.surface());
}

test('a decaying Camera-kick lands on a sub-cell offset and shifts the scene by a Pixel, not a whole cell', () => {
	// Half a kick duration decays a full-cell kick to exactly half a cell.
	const kick = stepKick(
		applyKick(NO_KICK, 1, 0),
		CAMERA_KICK.durationMs / (2 * CAMERA_KICK.maxCells),
	);
	expect(kick.x).toBeCloseTo(0.5);

	const base = paintAt(0);
	const half = paintAt(kick.x);
	const whole = paintAt(1);

	// The half-cell kick renders a distinct frame between the aligned frame and the
	// whole-cell frame — a genuine sub-cell (one-Pixel) shift.
	expect(half).not.toBe(base);
	expect(half).not.toBe(whole);
	expect(whole).not.toBe(base);
});
