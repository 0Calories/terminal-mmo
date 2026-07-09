import type { Entity } from '@mmo/core';
import { BOX, dodgePhase } from '@mmo/core';
import { spriteFor } from '@mmo/render';
import { type OptimizedBuffer, RGBA } from '@opentui/core';
import { COLORS as C } from '../theme';

export const SAMPLE_INTERVAL_MS = 90;
const FADE_MS = 300;
const PEAK_ALPHA = 235;
const ECHO_RGB: readonly [number, number, number] = [150, 220, 255];

export const DODGE_ECHO_LIFE_MS = FADE_MS;

export interface DodgeEcho {
	x: number;
	y: number;
	facing: Entity['facing'];
	type: Entity['type'];
	ageMs: number;
}

export function isDodging(e: Entity): boolean {
	return e.action?.move === 'dodge' || dodgePhase(e.dodgeT ?? 0) !== null;
}

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

export function stepDodgeEchoes(list: DodgeEcho[], dtMs: number): DodgeEcho[] {
	for (const echo of list) echo.ageMs += dtMs;
	return list.filter((echo) => echo.ageMs < DODGE_ECHO_LIFE_MS);
}

type DodgeTrack = {
	x: number;
	y: number;
	facing: Entity['facing'];
	dodging: boolean;
	sinceSampleMs: number;
};

/**
 * Watches entities across frames and turns dodge motion into echoes: one at the
 * pre-dodge origin the frame a dodge starts, then a sample every interval while
 * it lasts.
 */
export class DodgeTracker {
	private echoes: DodgeEcho[] = [];
	private track = new Map<number, DodgeTrack>();

	update(entities: readonly Entity[], dtMs: number): void {
		const nextTrack = new Map<number, DodgeTrack>();
		for (const e of entities) {
			const dodging = isDodging(e);
			const prev = this.track.get(e.id);
			const started = dodging && !prev?.dodging;
			let sinceSampleMs = (prev?.sinceSampleMs ?? 0) + dtMs;
			if (started) {
				spawnDodgeEcho(this.echoes, {
					x: prev?.x ?? e.x,
					y: prev?.y ?? e.y,
					facing: e.facing,
					type: e.type,
				});
				sinceSampleMs = 0;
			} else if (dodging && sinceSampleMs >= SAMPLE_INTERVAL_MS) {
				spawnDodgeEcho(this.echoes, {
					x: e.x,
					y: e.y,
					facing: e.facing,
					type: e.type,
				});
				sinceSampleMs = 0;
			}
			nextTrack.set(e.id, {
				x: e.x,
				y: e.y,
				facing: e.facing,
				dodging,
				sinceSampleMs,
			});
		}
		this.track = nextTrack;
		this.echoes = stepDodgeEchoes(this.echoes, dtMs);
	}

	draw(
		buf: OptimizedBuffer,
		cam: { x: number; y: number },
		sw: number,
		sh: number,
	): void {
		drawDodgeEchoes(buf, this.echoes, cam, sw, sh);
	}
}

export function drawDodgeEchoes(
	buf: OptimizedBuffer,
	list: readonly DodgeEcho[],
	cam: { x: number; y: number },
	sw: number,
	sh: number,
): void {
	for (const echo of list) {
		const fade = 1 - echo.ageMs / FADE_MS;
		if (fade <= 0) continue;
		const alpha = Math.round(PEAK_ALPHA * fade);
		if (alpha <= 0) continue;
		const col = RGBA.fromInts(ECHO_RGB[0], ECHO_RGB[1], ECHO_RGB[2], alpha);
		const sprite = spriteFor(echo.type);
		const rows = sprite.rows(echo.facing);
		// Sprite anchor must mirror drawEntitySprite: feet to the box bottom.
		const baseX = echo.x - Math.floor((sprite.w - BOX.w) / 2);
		const baseY = echo.y + BOX.h - sprite.h;
		for (let ry = 0; ry < rows.length; ry++) {
			const row = rows[ry];
			for (let rx = 0; rx < row.length; rx++) {
				if (row[rx] === ' ') continue;
				const px = Math.round(baseX + rx - cam.x);
				const py = Math.round(baseY + ry - cam.y);
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(px, py, row[rx], col, C.transparent);
			}
		}
	}
}
