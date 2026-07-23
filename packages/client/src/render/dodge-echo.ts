import { dodgePhase } from '@mmo/core/combat';
import type { Entity } from '@mmo/core/entities';
import type { Compositor } from '@mmo/render/compositor';
import {
	DODGE_ECHO_LIFE_MS,
	type DodgeEcho,
	drawDodgeEchoes,
} from '@mmo/render/scene';

export { DODGE_ECHO_LIFE_MS, type DodgeEcho } from '@mmo/render/scene';

export const SAMPLE_INTERVAL_MS = 90;

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

	draw(compositor: Compositor, cam: { x: number; y: number }): void {
		drawDodgeEchoes(compositor, this.echoes, cam);
	}
}
