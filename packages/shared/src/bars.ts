// Pure bar geometry for the terminal HUD: HP, EXP, and Stamina share one ruler — a value +
// max yields the fill fraction, a glyph width yields how many cells to light (#243).

// Clamp to [0,1]; a non-finite input collapses to the nearest extreme rather than leaking
// NaN/Infinity into the renderer.
export function clamp01(x: number): number {
	if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
	return Math.max(0, Math.min(1, x));
}

// Fill fraction, clamped to [0,1]. A non-positive or non-finite max reads empty (guards
// divide-by-zero / NaN before it reaches a glyph count).
export function fillRatio(current: number, max: number): number {
	if (!(max > 0)) return 0;
	return clamp01(current / max);
}

// How many of `width` cells a ratio lights up. Rounds to nearest, but never paints a full
// bar below 100% nor an empty bar above 0% — so "almost dead" still shows one pip and
// "almost full" still shows one gap.
export function filledCells(ratio: number, width: number): number {
	if (width <= 0) return 0;
	const r = clamp01(ratio);
	const cells = Math.round(r * width);
	if (r > 0 && cells === 0) return 1;
	if (r < 1 && cells === width) return width - 1;
	return cells;
}
