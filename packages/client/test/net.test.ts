import { expect, test } from 'bun:test';
import {
	BOX,
	GROUND_TOP,
	makeFieldZone,
	type ServerMessage,
	spawnAvatar,
} from '@mmo/shared';
import { snapshotToGame } from '../src/net';

const y = GROUND_TOP - BOX.h;

function snapshot(): Extract<ServerMessage, { t: 'snapshot' }> {
	return {
		t: 'snapshot',
		tick: 12,
		avatars: [
			{
				sessionId: 1,
				x: 40,
				y,
				vx: 0,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 50,
				maxHp: 80,
				hurtT: 0,
			},
		],
		monsters: [
			{
				id: 5,
				type: 'chaser',
				x: 60,
				y,
				vx: 0,
				vy: 0,
				facing: -1,
				onGround: true,
				hp: 12,
				maxHp: 24,
				hurtT: 0,
			},
		],
		projectiles: [
			{ id: 2, x: 55, y, vx: -36, vy: 0, life: 2, damage: 7, ownerId: 9 },
		],
		progress: { level: 4, xp: 30, gold: 11 },
		inventory: [],
		log: ['Looted rare Iron Sword.'],
	};
}

test('snapshotToGame renders snapshot monsters/projectiles with the predicted own Avatar', () => {
	const field = makeFieldZone('field-01');
	const predicted = { ...spawnAvatar(33, y), facing: -1 as const };
	const game = snapshotToGame(field, predicted, snapshot(), {});
	const zone = game.world.zones['field-01'];
	// own Avatar position comes from local prediction, not the snapshot
	expect(game.player.avatar.x).toBe(33);
	expect(game.player.avatar.facing).toBe(-1);
	// progress/log/zone entities come from the server snapshot
	expect(game.player.progress).toEqual({ level: 4, xp: 30, gold: 11 });
	expect(zone.monsters.length).toBe(1);
	expect(zone.monsters[0].type).toBe('chaser');
	expect(zone.projectiles.length).toBe(1);
	expect(game.world.tick).toBe(12);
});

test('snapshotToGame degrades gracefully before the first snapshot', () => {
	const field = makeFieldZone('field-01');
	const game = snapshotToGame(field, spawnAvatar(10, y), null, {});
	expect(game.world.zones['field-01'].monsters.length).toBe(0);
	expect(game.player.progress.level).toBe(1);
});
