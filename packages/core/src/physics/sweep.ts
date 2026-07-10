// sweep — the terrain-collision primitive: point travel through the cell grid.
//
// One primitive answers "what does a point travelling from A to B hit?" for
// any direction, and it carries the global one-way rule (ADR 0026, #262):
// descending travel lands on Walls AND One-way platform tops; ascending and
// sideways travel is blocked by Walls only. Both integrators — the
// Momentum-body step and the projectile step — resolve terrain through these
// sweeps, and the client particle engine rebuilds on `sweepPoint` (#362), so
// "what blocks a moving point" has exactly one answer. (The old downward-only
// particle sweep is the cautionary tale: rising specks embedded in ≥2-thick
// solids because nothing swept upward.)
//
// Boundary conventions (the ones the entity integrator has always used,
// generalized from "check the destination cell" to "check every cell crossed",
// so fast travel cannot tunnel):
// - Moving down/right, a point at an exact cell boundary is touching the next
//   cell — a body resting on surface row r re-collides with r every tick.
// - Moving up/left, an exact boundary belongs to floor(coord) — leaving your
//   own cell is not a collision.

import type { Terrain } from '../entities/types';
import { isSolid, isWall } from './terrain';

/**
 * First blocking row for a point travelling fromY→toY within column `col`;
 * null = clear. Carries the one-way rule vertically: descending hits any
 * solid (a One-way platform lands), ascending hits Walls only (a platform
 * passes). Module-internal — the barrel exports `sweepPoint`; the integrators
 * in this module compose the axis legs directly over box spans.
 */
export function sweepColumn(
	t: Terrain,
	col: number,
	fromY: number,
	toY: number,
): number | null {
	if (toY > fromY) {
		const last = Math.ceil(toY) - 1;
		for (let row = Math.ceil(fromY); row <= last; row++)
			if (isSolid(t, col, row)) return row;
	} else if (toY < fromY) {
		const last = Math.floor(toY);
		for (let row = Math.floor(fromY) - 1; row >= last; row--)
			if (isWall(t, col, row)) return row;
	}
	return null;
}

/**
 * First blocking column for a point travelling fromX→toX within row `row`;
 * null = clear. Only Walls block sideways travel — One-way platforms are
 * horizontally transparent (the one-way rule). Module-internal, as above.
 */
export function sweepRow(
	t: Terrain,
	row: number,
	fromX: number,
	toX: number,
): number | null {
	if (toX > fromX) {
		const last = Math.ceil(toX) - 1;
		for (let col = Math.ceil(fromX); col <= last; col++)
			if (isWall(t, col, row)) return col;
	} else if (toX < fromX) {
		const last = Math.floor(toX);
		for (let col = Math.floor(fromX) - 1; col >= last; col--)
			if (isWall(t, col, row)) return col;
	}
	return null;
}

export interface SweepHit {
	/** Which leg of the axis-separated travel collided. */
	axis: 'x' | 'y';
	/** The solid cell that blocked travel. */
	cx: number;
	cy: number;
	/** Travel clipped to the hit cell's near face. */
	x: number;
	y: number;
}

/**
 * Point travel for any direction, axis-separated x-then-y (the order both
 * integrators use): the x leg runs at the departure row, the y leg at the
 * arrival column. Returns the first hit with the clipped stop position, or
 * null for clear travel. A bounce/rest caller (particles, #362) zeroes the
 * blocked axis at `hit.x/hit.y` and re-sweeps the remaining leg.
 */
export function sweepPoint(
	t: Terrain,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
): SweepHit | null {
	const row = Math.floor(fromY);
	const hx = sweepRow(t, row, fromX, toX);
	if (hx !== null)
		return {
			axis: 'x',
			cx: hx,
			cy: row,
			x: toX > fromX ? hx : hx + 1,
			y: fromY,
		};
	const col = Math.floor(toX);
	const hy = sweepColumn(t, col, fromY, toY);
	if (hy !== null)
		return {
			axis: 'y',
			cx: col,
			cy: hy,
			x: toX,
			y: toY > fromY ? hy : hy + 1,
		};
	return null;
}
