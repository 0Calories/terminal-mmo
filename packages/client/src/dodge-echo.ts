// The Dodge after-image (ADR 0017 §5/§13e): a self-contained client visual effect,
// spawned on the dodge-start edge and ticked on the render clock — it owes NOTHING to
// the i-frame `dodgeT` it illustrates (decoupled by design, #165).
//
// A dodge SAMPLES the Avatar's live position over the hop: one echo at the launch spot,
// then another every SAMPLE_INTERVAL_MS as it dashes. Each echo is a single cyan
// silhouette of the Avatar's own sprite at the position it was captured, fading over
// FADE_MS. So the trail spans the WHOLE dash path — oldest/faintest back at the launch
// spot, newest/brightest right where the Avatar ends up — and stays faithful however far
// the burst carries (unlike a fixed cluster of offsets planted at the origin).
//
// Kept pure (spawn/step are array transforms, draw is a blit) so the lifecycle is
// unit-testable headlessly even though the pixels aren't.

import type { Entity } from '@mmo/shared';
import { BOX, dodgePhase, spriteFor } from '@mmo/shared';
import { type OptimizedBuffer, RGBA } from '@opentui/core';
import { COLORS as C } from './theme';

// --- Tunables (eyeball-verified in a real terminal; no automated assertion) --------
// Time between successive position samples while dodging. Smaller = a denser trail with
// more silhouettes spanning the dash; FADE_MS/SAMPLE_INTERVAL_MS echoes are alive at once.
export const SAMPLE_INTERVAL_MS = 90;
const FADE_MS = 300; // each silhouette's fade-out — quick but lingering (cf. blood's ~750ms, #163)
const PEAK_ALPHA = 235; // a silhouette's alpha at birth, before it fades
const ECHO_RGB: readonly [number, number, number] = [150, 220, 255]; // theme dodge cyan

// The wall-clock life of one silhouette: it fades from PEAK_ALPHA to nothing over FADE_MS,
// after which it's cullable.
export const DODGE_ECHO_LIFE_MS = FADE_MS;

// One captured silhouette: a frozen snapshot of where the Avatar was at one sample, aging
// on the render clock. Holds the sprite key + facing so it matches the dodging body.
export interface DodgeEcho {
	x: number; // captured position (world cells)
	y: number;
	facing: Entity['facing'];
	type: Entity['type'];
	ageMs: number; // time since capture, advanced by the render-frame dt
}

// Whether an entity is mid-Dodge THIS frame — true across the whole hop (active +
// recovery). Covers both representations: the local Avatar's predicted `dodgeT` and a
// co-present Avatar's replicated `action` (move 'dodge'), so one edge serves everyone.
export function isDodging(e: Entity): boolean {
	return e.action?.move === 'dodge' || dodgePhase(e.dodgeT ?? 0) !== null;
}

// True on the single frame a Dodge begins: the rising edge of `isDodging`. The render
// loop fires the first sample here, planting it at the PREVIOUS frame's position (the
// true pre-hop spot, before the hop integrated a tick of travel).
export function dodgeStarted(prev: Entity, next: Entity): boolean {
	return !isDodging(prev) && isDodging(next);
}

// Capture a silhouette at `origin` (a position + the dodging body's facing/sprite).
export function spawnDodgeEcho(
	list: DodgeEcho[],
	origin: Pick<Entity, 'x' | 'y' | 'facing' | 'type'>,
): void {
	list.push({
		x: origin.x,
		y: origin.y,
		facing: origin.facing,
		type: origin.type,
		ageMs: 0,
	});
}

// Advance every echo by the render-frame dt and drop the spent ones. Returns the live
// list (callers reassign, mirroring the immutable-ish step style of the other juice).
export function stepDodgeEchoes(list: DodgeEcho[], dtMs: number): DodgeEcho[] {
	for (const echo of list) echo.ageMs += dtMs;
	return list.filter((echo) => echo.ageMs < DODGE_ECHO_LIFE_MS);
}

// Blit every live echo: each is one silhouette at its captured position, fading linearly
// to nothing over FADE_MS (the blood fade curve, #163). The newest captures sit nearest
// the Avatar and read brightest (least faded); older ones trail back toward the launch
// spot and dim out — the motion wake.
export function drawDodgeEchoes(
	buf: OptimizedBuffer,
	list: readonly DodgeEcho[],
	cam: { x: number; y: number },
	sw: number,
	sh: number,
): void {
	for (const echo of list) {
		const fade = 1 - echo.ageMs / FADE_MS; // linear ramp to zero
		if (fade <= 0) continue;
		const alpha = Math.round(PEAK_ALPHA * fade);
		if (alpha <= 0) continue;
		const col = RGBA.fromInts(ECHO_RGB[0], ECHO_RGB[1], ECHO_RGB[2], alpha);
		const sprite = spriteFor(echo.type);
		const rows = sprite.rows(echo.facing);
		// Sprite anchor, mirroring drawEntitySprite (ADR 0003): centred over the ~1×2
		// box, feet to the box bottom — so the echo lines up with the body, not the head.
		const baseX = echo.x - Math.floor((sprite.w - BOX.w) / 2);
		const baseY = echo.y + BOX.h - sprite.h;
		for (let ry = 0; ry < rows.length; ry++) {
			const row = rows[ry];
			for (let rx = 0; rx < row.length; rx++) {
				if (row[rx] === ' ') continue; // transparent sprite cell
				const px = Math.round(baseX + rx - cam.x);
				const py = Math.round(baseY + ry - cam.y);
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(px, py, row[rx], col, C.transparent);
			}
		}
	}
}
