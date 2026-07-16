import { expect, test } from 'bun:test';
import type { Terrain } from '@mmo/core/entities';
import { isSolid, parseTerrain } from '@mmo/core/physics';
import { EFFECTS } from '../src/particles/effects';
import {
	advanceSpecks,
	Pool,
	spawnSpeck,
	speckDrawCell,
} from '../src/particles/engine';
import type { Speck } from '../src/particles/profile';
import { seededRng } from './helpers';

// The seeded property harness from the #353 diagnosis: over a wall-face and a
// two-thick-lintel fixture, across many seeds, no colliding speck may ever be
// inside a solid cell, no speck may ever be DRAWN embedded in solid (a settled
// speck may sit in the visible ▄ surface cell — solid with air above — but
// never in a wall-body cell), and every speck must reach extinction.

const SEEDS = 30;
// Past the longest maxLife (gore 7000ms) at 16ms frames, so extinction is provable.
const FRAMES = 500;
const DT = 16;

// A floor plus a full-height wall face at x >= 20 — the wall-face fixture
// (diagnosis: specks drawn motionless inside wall tiles at full alpha).
function wallFace(): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < 20; y++) {
		const cells = Array.from({ length: 30 }, (_, x) =>
			y === 19 || x >= 20 ? '#' : '.',
		);
		rows.push(cells.join(''));
	}
	return parseTerrain(rows);
}

// A floor plus a two-cell-thick lintel overhead — the lintel fixture
// (diagnosis: rising specks embed and rest inside the thick solid).
function lintel(): Terrain {
	const rows: string[] = [];
	for (let y = 0; y < 24; y++) {
		const slab = y === 8 || y === 9;
		const cells = Array.from({ length: 40 }, (_, x) =>
			y === 23 || (slab && x >= 5 && x < 35) ? '#' : '.',
		);
		rows.push(cells.join(''));
	}
	return parseTerrain(rows);
}

interface Fixture {
	name: string;
	terrain: Terrain;
	bursts: { x: number; y: number; dir: -1 | 0 | 1 }[];
}

const FIXTURES: Fixture[] = [
	{
		name: 'wall-face',
		terrain: wallFace(),
		bursts: [
			{ x: 18.5, y: 16, dir: 1 },
			{ x: 17, y: 10, dir: 1 },
			{ x: 19, y: 14, dir: 0 },
		],
	},
	{
		name: 'two-thick-lintel',
		terrain: lintel(),
		bursts: [
			{ x: 20, y: 13, dir: 0 },
			{ x: 12, y: 12, dir: 0 },
			{ x: 28, y: 13, dir: 1 },
		],
	},
];

// The exact projection the engine paints with.
function drawCell(p: Speck, t: Terrain): { col: number; row: number } {
	return speckDrawCell(p, t);
}

// A drawn cell is embedded when it is solid below another solid — inside the
// body of a wall/slab, never the visible ▄ surface row.
function embedded(t: Terrain, col: number, row: number): boolean {
	return isSolid(t, col, row) && isSolid(t, col, row - 1);
}

for (const fx of FIXTURES) {
	test(`${fx.name}: colliding specks never live or draw inside solid, and all reach extinction`, () => {
		for (let seed = 1; seed <= SEEDS; seed++) {
			const rng = seededRng(seed);
			const pool = new Pool(256);
			for (const b of fx.bursts) {
				for (let i = 0; i < EFFECTS.blood.count(24); i++)
					spawnSpeck(pool, EFFECTS.blood.profile, b.x, b.y, b.dir, rng);
				for (let i = 0; i < EFFECTS.gore.count(12); i++)
					spawnSpeck(pool, EFFECTS.gore.profile, b.x, b.y, b.dir, rng);
			}

			for (let frame = 0; frame < FRAMES; frame++) {
				advanceSpecks(pool, DT, fx.terrain);
				for (const p of pool.specks) {
					if (!p.active || !p.profile.collide) continue;

					// 1. No active colliding speck is ever inside a solid cell.
					const cx = Math.floor(p.x);
					const cy = Math.floor(p.y);
					if (isSolid(fx.terrain, cx, cy)) {
						throw new Error(
							`${fx.name} seed ${seed} frame ${frame}: active ${p.stage} speck inside solid cell (${cx},${cy}) at (${p.x},${p.y})`,
						);
					}

					// 2. No speck is ever drawn embedded in solid; airborne specks may
					// not be drawn in any solid cell at all.
					const { col, row } = drawCell(p, fx.terrain);
					const bad =
						p.stage === 'airborne'
							? isSolid(fx.terrain, col, row)
							: embedded(fx.terrain, col, row);
					if (bad) {
						throw new Error(
							`${fx.name} seed ${seed} frame ${frame}: ${p.stage} speck drawn into solid cell (${col},${row}) at (${p.x},${p.y})`,
						);
					}
				}
			}

			// 3. Every speck reaches extinction.
			expect(pool.activeCount).toBe(0);
		}
	});
}
