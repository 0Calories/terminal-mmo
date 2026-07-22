import type { Terrain } from '../entities/types';
import { isSolid, isWall } from './terrain';

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
	axis: 'x' | 'y';

	cx: number;
	cy: number;

	x: number;
	y: number;
}

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
