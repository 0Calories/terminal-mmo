import { expect, test } from 'bun:test';
import type { BrainView, Entity, Terrain } from '../../src/entities';
import { ARCHETYPES, BOX, BRAINS, spawnMonster } from '../../src/entities';
import { IDLE_DRIVE, parseTerrain } from '../../src/physics';
import { GROUND_TOP } from '../../src/zones';
import { flatTerrain } from '../helpers';

const y = GROUND_TOP - BOX.h;
const flat = flatTerrain();

function view(targetX: number | null, terrain: Terrain = flat): BrainView {
	return { terrain, targetX };
}

function grounded(type: 'chaser' | 'brute' | 'shooter', x: number): Entity {
	const m = spawnMonster(type, 2, x, y);
	m.onGround = true;
	return m;
}

function islandTerrain(w = 60, groundEnd = 30): Terrain {
	const rows: string[] = [];
	for (let cy = 0; cy < GROUND_TOP; cy++) rows.push('.'.repeat(w));
	for (let cy = GROUND_TOP; cy < GROUND_TOP + 3; cy++)
		rows.push('#'.repeat(groundEnd + 1) + '.'.repeat(w - groundEnd - 1));
	return parseTerrain(rows);
}

function walledTerrain(w = 60, wallX = 30): Terrain {
	const rows: string[] = [];
	for (let cy = 0; cy < GROUND_TOP + 3; cy++) {
		const solidRow = cy >= GROUND_TOP;
		let row = '';
		for (let cx = 0; cx < w; cx++) row += solidRow || cx === wallX ? '#' : '.';
		rows.push(row);
	}
	return parseTerrain(rows);
}

test('the melee Brain chases: moveX homes on a target inside aggro, no commit out of range', () => {
	const m = grounded('chaser', 50);
	const r = BRAINS.chaser(m, view(40));
	expect(r.drive.moveX).toBe(-1);
	expect(r.drive.jump).toBe(false);
	expect(r.drive.commit).toBeUndefined();
});

test('the melee Brain stands still inside its deadzone', () => {
	const m = grounded('chaser', 50);
	const r = BRAINS.chaser(m, view(51));
	expect(r.drive.moveX).toBe(0);
});

test('the melee Brain commits swing in range once off cooldown, squaring up to the target', () => {
	const m = grounded('chaser', 50);
	const r = BRAINS.chaser(m, view(47));
	expect(r.drive.commit).toBe('swing');
	expect(r.drive.face).toBe(-1);
});

test('a cooling-down melee Brain closes in but holds its swing', () => {
	const m = grounded('chaser', 50);
	m.attackCdT = 1;
	const r = BRAINS.chaser(m, view(47));
	expect(r.drive.commit).toBeUndefined();
});

test('a committed Brain is locked in: idle drive, no re-commit', () => {
	const m = grounded('chaser', 50);
	m.attackT = 0.2;
	const r = BRAINS.chaser(m, view(47));
	expect(r.drive).toEqual(IDLE_DRIVE);
});

test('a stunned Brain goes limp: idle drive', () => {
	const m = grounded('chaser', 50);
	m.stunT = 0.2;
	const r = BRAINS.chaser(m, view(47));
	expect(r.drive).toEqual(IDLE_DRIVE);
});

test('out of aggro the melee Brain patrols its facing', () => {
	const m = grounded('chaser', 50);
	m.facing = -1;
	const r = BRAINS.chaser(m, view(200));
	expect(r.drive.moveX).toBe(-1);
	expect(r.drive.commit).toBeUndefined();
});

test('patrol turns at a ledge', () => {
	const t = islandTerrain();
	const m = grounded('chaser', 27);
	m.facing = 1;
	const r = BRAINS.chaser(m, view(null, t));
	expect(r.drive.moveX).toBe(-1);
});

test('patrol turns at a wall', () => {
	const t = walledTerrain();
	const m = grounded('chaser', 24.5);
	m.facing = 1;
	const r = BRAINS.chaser(m, view(null, t));
	expect(r.drive.moveX).toBe(-1);
});

test('airborne patrol keeps heading — no ground probing mid-fall', () => {
	const t = islandTerrain();
	const m = spawnMonster('chaser', 2, 27, y - 5);
	m.facing = 1;
	const r = BRAINS.chaser(m, view(null, t));
	expect(r.drive.moveX).toBe(1);
});

test('the brute runs the melee Brain over its OWN profile (commits at brute range)', () => {
	const adx5 = view(45);
	const brute = grounded('brute', 50);
	expect(BRAINS.brute(brute, adx5).drive.commit).toBe('swing');
	const chaser = grounded('chaser', 50);
	expect(BRAINS.chaser(chaser, adx5).drive.commit).toBeUndefined();
	expect(ARCHETYPES.brute.melee.range).toBeGreaterThan(
		ARCHETYPES.chaser.melee.range,
	);
});

test('the shooter Brain patrols outside aggro', () => {
	const m = grounded('shooter', 50);
	m.facing = -1;
	const r = BRAINS.shooter(m, view(50 + ARCHETYPES.shooter.ranged.aggro));
	expect(r.drive.moveX).toBe(-1);
	expect(r.drive.commit).toBeUndefined();
	expect(r.ai).toEqual({ state: 'patrol' });
});

test('inside keepDist the shooter REPOSITIONS: backs away, eyes on the target, never fires', () => {
	const m = grounded('shooter', 30);
	m.attackCdT = 0;
	const r = BRAINS.shooter(m, view(25));
	expect(r.drive.moveX).toBe(1);
	expect(r.drive.face).toBe(-1);
	expect(r.drive.commit).toBeUndefined();
	expect(r.ai).toEqual({ state: 'reposition' });
});

test('in the comfort band the shooter ATTACKS: holds ground and commits fire', () => {
	const m = grounded('shooter', 50);
	const r = BRAINS.shooter(m, view(20));
	expect(r.drive.moveX).toBe(0);
	expect(r.drive.face).toBe(-1);
	expect(r.drive.commit).toBe('fire');
	expect(r.ai).toEqual({ state: 'attack' });
});

test('in the band but on cooldown the shooter holds fire', () => {
	const m = grounded('shooter', 50);
	m.attackCdT = 1;
	const r = BRAINS.shooter(m, view(20));
	expect(r.drive.commit).toBeUndefined();
	expect(r.ai).toEqual({ state: 'attack' });
});

test('reposition → attack sequencing: fire is committed only once the band is restored', () => {
	const { keepDist } = ARCHETYPES.shooter.ranged;
	let m = grounded('shooter', 30);
	const targetX = 25;
	const states: string[] = [];
	let committedFire = false;

	for (let i = 0; i < 30 && !committedFire; i++) {
		const r = BRAINS.shooter(m, view(targetX));
		states.push((r.ai as { state: string }).state);
		if (r.drive.commit === 'fire') {
			committedFire = true;
			expect(Math.abs(targetX - m.x)).toBeGreaterThanOrEqual(keepDist);
			break;
		}
		expect(r.drive.moveX).toBe(1);
		m = { ...m, x: m.x + 1, ai: r.ai };
	}
	expect(committedFire).toBe(true);
	expect(states[0]).toBe('reposition');
	expect(states.at(-1)).toBe('attack');

	expect(states.includes('reposition')).toBe(true);
	expect(states.indexOf('attack')).toBe(states.lastIndexOf('reposition') + 1);
});

test('the band edge has hysteresis: at the same distance, the prior state (ai memory) decides', () => {
	const { keepDist } = ARCHETYPES.shooter.ranged;
	const targetX = 50 - (keepDist + 1);
	const repositioning = grounded('shooter', 50);
	repositioning.ai = { state: 'reposition' };
	const r1 = BRAINS.shooter(repositioning, view(targetX));
	expect(r1.drive.commit).toBeUndefined();
	expect(r1.drive.moveX).toBe(1);
	expect(r1.ai).toEqual({ state: 'reposition' });
	const attacking = grounded('shooter', 50);
	attacking.ai = { state: 'attack' };
	const r2 = BRAINS.shooter(attacking, view(targetX));
	expect(r2.drive.commit).toBe('fire');
	expect(r2.ai).toEqual({ state: 'attack' });
});

test('a committed shooter is locked in: idle drive, aim frozen', () => {
	const m = grounded('shooter', 50);
	m.attackT = 0.2;
	m.ai = { state: 'attack' };
	const r = BRAINS.shooter(m, view(45));
	expect(r.drive).toEqual(IDLE_DRIVE);
	expect(r.ai).toEqual({ state: 'attack' });
});
