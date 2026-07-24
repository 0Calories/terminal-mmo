import { expect, test } from 'bun:test';
import type { BrainView, Entity, Terrain } from '../../src/entities';
import { ARCHETYPES, BOX, BRAINS, spawnMonster } from '../../src/entities';
import { IDLE_DRIVE, parseTerrain } from '../../src/physics';
import { GROUND_TOP } from '../../src/zones';
import { flatTerrain, islandTerrain } from '../helpers';

const y = GROUND_TOP - BOX.h;
const flat = flatTerrain();

function view(targetX: number | null, terrain: Terrain = flat): BrainView {
	return { terrain, targetX };
}

function grounded(
	type: 'slime' | 'chaser' | 'brute' | 'shooter',
	x: number,
): Entity {
	const m = spawnMonster(type, 2, x, y);
	m.onGround = true;
	return m;
}

const targetLeftBy = (monster: Entity, gap: number) => monster.x - gap;

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
	const { range, aggro } = ARCHETYPES.chaser.melee;
	const r = BRAINS.chaser(m, view(targetLeftBy(m, (range + aggro) / 2)));
	expect(r.drive.moveX).toBe(-1);
	expect(r.drive.jump).toBe(false);
	expect(r.drive.commit).toBeUndefined();
});

test('the melee Brain stands still inside its deadzone', () => {
	const m = grounded('chaser', 50);
	const r = BRAINS.chaser(
		m,
		view(targetLeftBy(m, ARCHETYPES.chaser.melee.deadzone / 2)),
	);
	expect(r.drive.moveX).toBe(0);
});

test('the melee Brain commits swing in range once off cooldown, squaring up to the target', () => {
	const m = grounded('chaser', 50);
	const r = BRAINS.chaser(
		m,
		view(targetLeftBy(m, ARCHETYPES.chaser.melee.range)),
	);
	expect(r.drive.commit).toBe('swing');
	expect(r.drive.face).toBe(-1);
});

test('a cooling-down melee Brain closes in but holds its swing', () => {
	const m = grounded('chaser', 50);
	m.attackCdT = 1;
	const r = BRAINS.chaser(
		m,
		view(targetLeftBy(m, ARCHETYPES.chaser.melee.range)),
	);
	expect(r.drive.commit).toBeUndefined();
});

test('a committed Brain is locked in: idle drive, no re-commit', () => {
	const m = grounded('chaser', 50);
	m.attackT = 0.2;
	const r = BRAINS.chaser(m, view(targetLeftBy(m, 1)));
	expect(r.drive).toEqual(IDLE_DRIVE);
});

test('a stunned Brain goes limp: idle drive', () => {
	const m = grounded('chaser', 50);
	m.stunT = 0.2;
	const r = BRAINS.chaser(m, view(targetLeftBy(m, 1)));
	expect(r.drive).toEqual(IDLE_DRIVE);
});

test('out of aggro the melee Brain patrols its facing', () => {
	const m = grounded('chaser', 50);
	m.facing = -1;
	const r = BRAINS.chaser(m, view(m.x + ARCHETYPES.chaser.melee.aggro));
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

test('every melee Brain uses its own configured commit range', () => {
	for (const type of ['chaser', 'brute'] as const) {
		const monster = grounded(type, 50);
		const { range } = ARCHETYPES[type].melee;
		expect(
			BRAINS[type](monster, view(targetLeftBy(monster, range))).drive.commit,
		).toBe('swing');
		expect(
			BRAINS[type](monster, view(targetLeftBy(monster, range + 0.01))).drive
				.commit,
		).toBeUndefined();
	}
});

function nextHop(m: Entity, v: BrainView, ticks = 200) {
	for (let i = 0; i < ticks; i++) {
		const r = BRAINS.slime(m, v);
		m.ai = r.ai;
		if (r.drive.jump) return r;
		expect(r.drive.moveX).toBe(0);
	}
	return null;
}

test('the slime never walks: grounded drives either rest in place or hop', () => {
	const m = grounded('slime', 50);
	const hop = nextHop(m, view(null));
	if (hop === null) throw new Error('slime never hopped');
	expect(hop.drive.moveX).toBe(m.facing);
});

test('slime patrol hops are lazy: a rest separates consecutive hops', () => {
	const m = grounded('slime', 50);
	nextHop(m, view(null));
	const r = BRAINS.slime(m, view(null));
	m.ai = r.ai;
	expect(r.drive.jump).toBe(false);
	expect(r.drive.moveX).toBe(0);
});

test('airborne the slime keeps its heading so the hop travels', () => {
	const m = spawnMonster('slime', 2, 50, y - 5);
	m.facing = -1;
	const r = BRAINS.slime(m, view(null));
	expect(r.drive.moveX).toBe(-1);
	expect(r.drive.jump).toBe(false);
});

test('slime patrol turns at a ledge like a walker does', () => {
	const t = islandTerrain();
	const m = grounded('slime', 27);
	m.facing = 1;
	const hop = nextHop(m, view(null, t));
	if (hop === null) throw new Error('slime never hopped');
	expect(hop.drive.moveX).toBe(-1);
});

test('a platform too short for a full hop never freezes the slime', () => {
	const t = islandTerrain(60, 8);
	const m = grounded('slime', 1);
	m.facing = 1;
	const hop = nextHop(m, view(null, t));
	if (hop === null) throw new Error('slime froze on a short platform');
	expect(hop.drive.jump).toBe(true);
});

test('slime patrol turns at a wall', () => {
	const t = walledTerrain();
	const m = grounded('slime', 24.5);
	m.facing = 1;
	const hop = nextHop(m, view(null, t));
	if (hop === null) throw new Error('slime never hopped');
	expect(hop.drive.moveX).toBe(-1);
});

test('an aggroed slime traversal-hops toward its target', () => {
	const m = grounded('slime', 50);
	m.facing = 1;
	const { range, aggro } = ARCHETYPES.slime.melee;
	const targetX = targetLeftBy(m, (range + aggro) / 2);
	const hop = nextHop(m, view(targetX));
	if (hop === null) throw new Error('slime never hopped');
	expect(hop.drive.moveX).toBe(-1);
});

test('the slime commits a pounce in leap range once off cooldown, squaring up', () => {
	const m = grounded('slime', 50);
	const r = BRAINS.slime(
		m,
		view(targetLeftBy(m, ARCHETYPES.slime.melee.range)),
	);
	expect(r.drive.commit).toBe('pounce');
	expect(r.drive.face).toBe(-1);
	expect(r.drive.jump).toBe(false);
});

test('spotting a target cancels a patrol rest: the slime gives chase at once', () => {
	const m = grounded('slime', 50);
	nextHop(m, view(null));
	const { range, aggro } = ARCHETYPES.slime.melee;
	const r = BRAINS.slime(m, view(targetLeftBy(m, (range + aggro) / 2)));
	expect(r.drive.jump).toBe(true);
	expect(r.drive.moveX).toBe(-1);
});

test('approach rests survive awareness: the chase stays paced, eyes on the target', () => {
	const m = grounded('slime', 50);
	const { range, aggro } = ARCHETYPES.slime.melee;
	const targetX = targetLeftBy(m, (range + aggro) / 2);
	nextHop(m, view(targetX));
	const r = BRAINS.slime(m, view(targetX));
	expect(r.drive.jump).toBe(false);
	expect(r.drive.moveX).toBe(0);
	expect(r.drive.face).toBe(-1);
});

test('a resting slime still pounces: rest never gates the commit', () => {
	const m = grounded('slime', 50);
	nextHop(m, view(null));
	const r = BRAINS.slime(
		m,
		view(targetLeftBy(m, ARCHETYPES.slime.melee.range)),
	);
	expect(r.drive.commit).toBe('pounce');
	expect(r.drive.face).toBe(-1);
});

test('a mid-hop slime holds its pounce: no commit while airborne', () => {
	const m = spawnMonster('slime', 2, 50, y - 5);
	const r = BRAINS.slime(m, view(targetLeftBy(m, 1)));
	expect(r.drive.commit).toBeUndefined();
});

test('a cooling-down slime keeps traversal-hopping without committing', () => {
	const m = grounded('slime', 50);
	m.attackCdT = 1;
	for (let i = 0; i < 200; i++) {
		const r = BRAINS.slime(m, view(m.x + 1));
		m.ai = r.ai;
		expect(r.drive.commit).toBeUndefined();
	}
});

test('beyond leap range the slime approaches instead of committing', () => {
	const m = grounded('slime', 50);
	const r = BRAINS.slime(
		m,
		view(targetLeftBy(m, ARCHETYPES.slime.melee.range + 0.01)),
	);
	expect(r.drive.commit).toBeUndefined();
});

test('a stunned slime Brain goes limp: idle drive', () => {
	const m = grounded('slime', 50);
	m.stunT = 0.2;
	const r = BRAINS.slime(m, view(targetLeftBy(m, 1)));
	expect(r.drive).toEqual(IDLE_DRIVE);
});

test('the shooter Brain patrols outside aggro', () => {
	const m = grounded('shooter', 50);
	m.facing = -1;
	const r = BRAINS.shooter(m, view(50 + ARCHETYPES.shooter.ranged.aggro));
	expect(r.drive.moveX).toBe(-1);
	expect(r.drive.commit).toBeUndefined();
	expect(r.ai).toEqual({ state: 'patrol' });
});

test('inside keepDist the shooter repositions without firing', () => {
	const m = grounded('shooter', 30);
	m.attackCdT = 0;
	const r = BRAINS.shooter(
		m,
		view(targetLeftBy(m, ARCHETYPES.shooter.ranged.keepDist - 1)),
	);
	expect(r.drive.moveX).toBe(1);
	expect(r.drive.face).toBe(-1);
	expect(r.drive.commit).toBeUndefined();
	expect(r.ai).toMatchObject({ state: 'combat' });
});

test('in the comfort band the shooter holds ground and commits fire', () => {
	const m = grounded('shooter', 50);
	const { keepDist, aggro } = ARCHETYPES.shooter.ranged;
	const r = BRAINS.shooter(m, view(targetLeftBy(m, (keepDist + aggro) / 2)));
	expect(r.drive.moveX).toBe(0);
	expect(r.drive.face).toBe(-1);
	expect(r.drive.commit).toBe('fire');
	expect(r.ai).toMatchObject({ state: 'combat' });
});

test('in the band but on cooldown the shooter holds fire', () => {
	const m = grounded('shooter', 50);
	m.attackCdT = 1;
	const { keepDist, aggro } = ARCHETYPES.shooter.ranged;
	const r = BRAINS.shooter(m, view(targetLeftBy(m, (keepDist + aggro) / 2)));
	expect(r.drive.commit).toBeUndefined();
	expect(r.ai).toMatchObject({ state: 'combat' });
});

test('a committed shooter is locked in: idle drive, aim frozen', () => {
	const m = grounded('shooter', 50);
	m.attackT = 0.2;
	m.ai = { state: 'combat' };
	const r = BRAINS.shooter(m, view(45));
	expect(r.drive).toEqual(IDLE_DRIVE);
	expect(r.ai).toEqual({ state: 'combat' });
});
