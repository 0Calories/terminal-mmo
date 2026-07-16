import { expect, test } from 'bun:test';
import { DODGE_TOTAL, IDLE_ACTION } from '@mmo/core/combat';
import type { Entity } from '@mmo/core/entities';
import {
	DODGE_ECHO_LIFE_MS,
	type DodgeEcho,
	dodgeStarted,
	isDodging,
	spawnDodgeEcho,
	stepDodgeEchoes,
} from '../src/render/dodge-echo';

function avatar(over: Partial<Entity> = {}): Entity {
	return {
		id: 1,
		type: 'player',
		x: 10,
		y: 4,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 80,
		maxHp: 80,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

test('isDodging is true across the hop via predicted dodgeT', () => {
	expect(isDodging(avatar({ dodgeT: DODGE_TOTAL }))).toBe(true);
	expect(isDodging(avatar({ dodgeT: 0 }))).toBe(false);
});

test('isDodging is true via a co-present Avatar’s replicated action', () => {
	const dodging = avatar({
		action: { ...IDLE_ACTION, move: 'dodge', phase: 'active', progress: 0 },
	});
	expect(isDodging(dodging)).toBe(true);
});

test('dodgeStarted fires only on the rising edge, not while the hop continues', () => {
	const idle = avatar({ dodgeT: 0 });
	const hopping = avatar({ dodgeT: DODGE_TOTAL });
	expect(dodgeStarted(idle, hopping)).toBe(true);
	expect(dodgeStarted(hopping, avatar({ dodgeT: DODGE_TOTAL * 0.5 }))).toBe(
		false,
	);
	expect(dodgeStarted(hopping, idle)).toBe(false);
});

test('an echo ages on the render clock and is culled once spent', () => {
	const echoes: DodgeEcho[] = [];
	spawnDodgeEcho(echoes, { x: 42, y: 7, facing: 1, type: 'player' });
	expect(echoes).toHaveLength(1);

	const live = stepDodgeEchoes(echoes, DODGE_ECHO_LIFE_MS - 1);
	expect(live).toHaveLength(1);

	const dead = stepDodgeEchoes(live, 1);
	expect(dead).toHaveLength(0);
});

test('the planted echo captures the pre-hop origin and the hop facing', () => {
	const echoes: DodgeEcho[] = [];
	spawnDodgeEcho(echoes, { x: 42, y: 7, facing: -1, type: 'player' });
	expect(echoes[0]).toMatchObject({ x: 42, y: 7, facing: -1, ageMs: 0 });
});

import type { OptimizedBuffer } from '@opentui/core';
import { DodgeTracker } from '../src/render/dodge-echo';

test('the tracker turns a dodge rising edge into a drawn echo — an idle entity leaves none', () => {
	const cells: { x: number; y: number }[] = [];
	const buf = {
		setCellWithAlphaBlending(x: number, y: number) {
			cells.push({ x, y });
		},
	} as unknown as OptimizedBuffer;

	const tracker = new DodgeTracker();
	const still = avatar({ dodgeT: 0 });
	tracker.update([still], 16);
	tracker.draw(buf, { x: 0, y: 0 }, 64, 24);
	expect(cells.length).toBe(0);

	tracker.update([{ ...still, dodgeT: 0.2 }], 16);
	tracker.draw(buf, { x: 0, y: 0 }, 64, 24);
	expect(cells.length).toBeGreaterThan(0);
});
