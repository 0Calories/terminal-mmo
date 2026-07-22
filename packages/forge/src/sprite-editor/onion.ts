import type { RGBAQuad } from '@mmo/core/entities';

export type OnionTint = 'prev' | 'next';

export function previousGhostFrame(
	frames: readonly string[],
	active: string,
): string | null {
	const n = frames.length;
	const i = frames.indexOf(active);
	if (n <= 1 || i < 0) return null;
	return frames[(i - 1 + n) % n];
}

const GHOST_MAX_ALPHA = 0.72;
const PREV_TINT: readonly [number, number, number] = [214, 74, 74];
const NEXT_TINT: readonly [number, number, number] = [74, 118, 224];

export function ghostColor(
	tint: OnionTint,
	intensity: number,
	bg: RGBAQuad,
): RGBAQuad {
	const [tr, tg, tb] = tint === 'prev' ? PREV_TINT : NEXT_TINT;
	const a = Math.max(0, Math.min(1, intensity)) * GHOST_MAX_ALPHA;
	const mix = (c: number, t: number): number => Math.round(c + (t - c) * a);
	return [mix(bg[0], tr), mix(bg[1], tg), mix(bg[2], tb), 255];
}
