export function clamp01(x: number): number {
	if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
	return Math.max(0, Math.min(1, x));
}

export function fillRatio(current: number, max: number): number {
	if (!(max > 0)) return 0;
	return clamp01(current / max);
}

export function filledCells(ratio: number, width: number): number {
	if (width <= 0) return 0;
	const r = clamp01(ratio);
	const cells = Math.round(r * width);
	if (r > 0 && cells === 0) return 1;
	if (r < 1 && cells === width) return width - 1;
	return cells;
}
