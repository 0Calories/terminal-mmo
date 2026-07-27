import { BOX, type Entity } from '@mmo/core/entities';
import type { Compositor, RGBA } from '@mmo/render/compositor';
import { rgba } from '@mmo/render/compositor';
import { actorSpriteTop } from '@mmo/render/sprites';
import type { DamageNumber, DamageNumberStyle } from './present';

/** Resolves a CombatEvent target to the entity the client currently renders;
 *  undefined when it is already gone (e.g. removed the tick it was hit). */
export type TargetResolver = (targetId: number) => Entity | undefined;

export const DAMAGE_NUMBER = {
	durMs: 600,
	driftCells: 5.5,
	/** Pixels of clearance between the target's head and the spawned digits. */
	headGapPx: 2,
	/** Life fraction where the ordered-dither dissolve starts eating pixels. */
	dissolveStart: 0.65,
} as const;

// Pixel fonts, rows top→bottom, 'X' = ink. Tall (3×5) is the hit/avatar face;
// break (5×6) is the heavier face for poise breaks.
const FONT_TALL: Record<string, readonly string[]> = {
	'0': ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
	'1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
	'2': ['XXX', '..X', 'XXX', 'X..', 'XXX'],
	'3': ['XXX', '..X', '.XX', '..X', 'XXX'],
	'4': ['X.X', 'X.X', 'XXX', '..X', '..X'],
	'5': ['XXX', 'X..', 'XXX', '..X', 'XXX'],
	'6': ['XXX', 'X..', 'XXX', 'X.X', 'XXX'],
	'7': ['XXX', '..X', '..X', '.X.', '.X.'],
	'8': ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
	'9': ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
};

const FONT_BREAK: Record<string, readonly string[]> = {
	'0': ['.XXX.', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', '.XXX.'],
	'1': ['..XX.', '.XXX.', '..XX.', '..XX.', '..XX.', 'XXXXX'],
	'2': ['.XXX.', 'XX.XX', '...XX', '..XX.', '.XX..', 'XXXXX'],
	'3': ['XXXX.', '...XX', '.XXX.', '...XX', 'XX.XX', '.XXX.'],
	'4': ['XX.XX', 'XX.XX', 'XXXXX', '...XX', '...XX', '...XX'],
	'5': ['XXXXX', 'XX...', 'XXXX.', '...XX', 'XX.XX', '.XXX.'],
	'6': ['.XXXX', 'XX...', 'XXXX.', 'XX.XX', 'XX.XX', '.XXX.'],
	'7': ['XXXXX', '...XX', '..XX.', '..XX.', '.XX..', '.XX..'],
	'8': ['.XXX.', 'XX.XX', '.XXX.', 'XX.XX', 'XX.XX', '.XXX.'],
	'9': ['.XXX.', 'XX.XX', 'XX.XX', '.XXXX', '...XX', 'XXXX.'],
};

/**
 * Deterministic spawn offsets (Pixels) cycled per target so rapid numbers on
 * one spot spread instead of overprinting — every observer sees the same
 * digits at the same place because the cycle is driven by hit order alone.
 */
export const JITTER_CYCLE: readonly (readonly [number, number])[] = [
	[0, 0],
	[4, -1],
	[-4, 0],
	[7, 1],
	[-7, -1],
	[2, -2],
];

const STYLE_FILL: Record<DamageNumberStyle, RGBA> = {
	hit: rgba(255, 244, 180),
	break: rgba(255, 150, 40),
	avatar: rgba(255, 84, 70),
};
/** Shadow rims darker than the fill but well clear of the near-black bg. */
const STYLE_EDGE: Record<DamageNumberStyle, RGBA> = {
	hit: rgba(148, 92, 16),
	break: rgba(150, 40, 10),
	avatar: rgba(118, 12, 12),
};

/** Ordered-dither thresholds: on fade-out pixels drop, colours never fade. */
const BAYER4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
] as const;

export interface LiveNumber {
	value: number;
	style: DamageNumberStyle;
	targetId: number;
	/** Bottom-centre spawn point in world sub-cell Pixels; never re-tracked. */
	px: number;
	py: number;
	born: number;
	/** A predicted own hit awaiting the authority's possible break conversion. */
	pending: boolean;
}

function fontFor(style: DamageNumberStyle): Record<string, readonly string[]> {
	return style === 'break' ? FONT_BREAK : FONT_TALL;
}

function glyphWidth(font: Record<string, readonly string[]>): number {
	return font['0'][0].length;
}

function glyphHeight(font: Record<string, readonly string[]>): number {
	return font['0'].length;
}

function drawBitmap(
	compositor: Compositor,
	font: Record<string, readonly string[]>,
	text: string,
	leftPx: number,
	topPy: number,
	color: RGBA,
	keep?: (px: number, py: number) => boolean,
): void {
	const dw = glyphWidth(font);
	let x = leftPx;
	for (const ch of text) {
		const rows = font[ch];
		if (rows) {
			for (let ry = 0; ry < rows.length; ry++) {
				for (let rx = 0; rx < dw; rx++) {
					if (rows[ry][rx] !== 'X') continue;
					if (keep && !keep(x + rx, topPy + ry)) continue;
					compositor.setPixel(x + rx, topPy + ry, color);
				}
			}
		}
		x += dw + 1;
	}
}

function drawNumber(
	compositor: Compositor,
	n: LiveNumber,
	camPx: number,
	camPy: number,
	now: number,
): void {
	const progress = (now - n.born) / DAMAGE_NUMBER.durMs;
	if (progress >= 1) return;

	const font = fontFor(n.style);
	const text = String(Math.round(n.value));
	const dw = glyphWidth(font);
	const widthPx = text.length * (dw + 1) - 1;

	// Half-cell steps: the drift rounds to whole Pixels, never fractions.
	const topPy =
		Math.round(
			n.py - glyphHeight(font) - progress * DAMAGE_NUMBER.driftCells * 2,
		) - camPy;
	const leftPx = Math.round(n.px - widthPx / 2) - camPx;

	const { dissolveStart } = DAMAGE_NUMBER;
	const f =
		progress <= dissolveStart
			? 0
			: (progress - dissolveStart) / (1 - dissolveStart);
	const keep =
		f > 0
			? (px: number, py: number) => BAYER4[py & 3][px & 3] / 16 >= f
			: undefined;

	drawBitmap(
		compositor,
		font,
		text,
		leftPx + 1,
		topPy + 1,
		STYLE_EDGE[n.style],
		keep,
	);
	drawBitmap(compositor, font, text, leftPx, topPy, STYLE_FILL[n.style], keep);
}

/**
 * Owns Damage number lifetimes on the render clock: spawns from the `present`
 * numbers channel, converts the pending predicted number when the authority's
 * own-sourced break resolves the same swing, and applies the per-target
 * overlap-jitter cycle only while earlier numbers on that target still live.
 */
export class DamageNumberTracker {
	private live: LiveNumber[] = [];
	private readonly cycle = new Map<number, number>();

	numbers(): readonly LiveNumber[] {
		return this.live;
	}

	clear(): void {
		this.live = [];
		this.cycle.clear();
	}

	spawn(
		numbers: readonly DamageNumber[],
		now: number,
		resolveTarget?: TargetResolver,
	): void {
		this.expire(now);
		for (const n of numbers) this.spawnOne(n, now, resolveTarget);
	}

	private spawnOne(
		n: DamageNumber,
		now: number,
		resolveTarget?: TargetResolver,
	): void {
		if (n.style === 'break' && n.own && this.convert(n, now)) return;
		const contested = this.live.some((l) => l.targetId === n.targetId);
		if (!contested) this.cycle.set(n.targetId, 0);
		const idx = this.cycle.get(n.targetId) ?? 0;
		this.cycle.set(n.targetId, idx + 1);
		const [dx, dy] = JITTER_CYCLE[idx % JITTER_CYCLE.length];
		// The head the number sits on is the drawn art's top row, not the logical
		// box top — a short sprite (slime) doesn't fill the box, and a tall one
		// (brute) extends above it. The event y is the fallback for a target
		// already gone by spawn time.
		const target = resolveTarget?.(n.targetId);
		const topY =
			target !== undefined ? actorSpriteTop(target) : n.y - BOX.h / 2;
		this.live.push({
			value: n.value,
			style: n.style,
			targetId: n.targetId,
			px: Math.round(n.x * 2) + dx,
			py: Math.round(topY * 2) - DAMAGE_NUMBER.headGapPx + dy,
			born: now,
			pending: n.style === 'hit' && n.own,
		});
	}

	private convert(n: DamageNumber, now: number): boolean {
		for (let i = this.live.length - 1; i >= 0; i--) {
			const l = this.live[i];
			if (l.targetId !== n.targetId || !l.pending) continue;
			l.style = 'break';
			l.value = n.value;
			l.born = now;
			l.pending = false;
			return true;
		}
		return false;
	}

	private expire(now: number): void {
		this.live = this.live.filter((l) => now - l.born < DAMAGE_NUMBER.durMs);
	}

	draw(compositor: Compositor, cam: { x: number; y: number }, now: number) {
		this.expire(now);
		const camPx = Math.round(cam.x * 2);
		const camPy = Math.round(cam.y * 2);
		for (const n of this.live) drawNumber(compositor, n, camPx, camPy, now);
	}
}
