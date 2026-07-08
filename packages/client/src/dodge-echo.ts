// The Dodge after-image (ADR 0017 §13e): a self-contained client effect on the render
// clock — decoupled from the i-frame `dodgeT` it illustrates (#165). It samples the
// Avatar's live position over the hop (one echo per SAMPLE_INTERVAL_MS), so the trail
// spans the whole dash path rather than a fixed cluster planted at the origin.

import type { Entity } from '@mmo/shared';
import { BOX, dodgePhase, spriteFor } from '@mmo/shared';
import { type OptimizedBuffer, RGBA } from '@opentui/core';
import { COLORS as C } from './theme';

// --- Tunables (eyeball-verified in a real terminal; no automated assertion) --------
// Time between position samples while dodging; FADE_MS/SAMPLE_INTERVAL_MS echoes alive at once.
export const SAMPLE_INTERVAL_MS = 90;
const FADE_MS = 300; // each silhouette's fade-out — quick but lingering (cf. blood's ~750ms, #163)
const PEAK_ALPHA = 235; // a silhouette's alpha at birth, before it fades
const ECHO_RGB: readonly [number, number, number] = [150, 220, 255]; // theme dodge cyan

export const DODGE_ECHO_LIFE_MS = FADE_MS;

export interface DodgeEcho {
	x: number; // captured position (world cells)
	y: number;
	facing: Entity['facing'];
	type: Entity['type'];
	ageMs: number; // time since capture, advanced by the render-frame dt
}

// Mid-Dodge this frame (whole hop). Covers both the local Avatar's predicted `dodgeT`
// and a co-present Avatar's replicated `action`, so one edge serves everyone.
export function isDodging(e: Entity): boolean {
	return e.action?.move === 'dodge' || dodgePhase(e.dodgeT ?? 0) !== null;
}

// Rising edge of `isDodging`. The render loop plants the first sample at the PREVIOUS
// frame's position — the true pre-hop spot, before the hop integrated a tick of travel.
export function dodgeStarted(prev: Entity, next: Entity): boolean {
	return !isDodging(prev) && isDodging(next);
}

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

// Advance every echo by the render-frame dt and drop spent ones. Returns the live list
// (callers reassign).
export function stepDodgeEchoes(list: DodgeEcho[], dtMs: number): DodgeEcho[] {
	for (const echo of list) echo.ageMs += dtMs;
	return list.filter((echo) => echo.ageMs < DODGE_ECHO_LIFE_MS);
}

// Blit every live echo, fading linearly over FADE_MS (the blood fade curve, #163) — newest
// captures brightest, older ones dimming back toward the launch spot.
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
		// Sprite anchor, mirroring drawEntitySprite (ADR 0003): feet to the box bottom, so
		// the echo lines up with the body, not the head.
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
