import { COMBAT, type CombatEvent } from '@mmo/core/combat';
import type { Tint } from '@mmo/core/entities';

/**
 * The client-side projection point (ADR 0029): the one place a server
 * CombatEvent becomes a client-owned VisualEffect. It retires the on-wire
 * Effect (see CONTEXT.md "VisualEffect") — the server now broadcasts
 * semantic events, and each client projects them locally, dropping
 * server-internal fields (like `hit`'s echo-suppression `source`) that
 * never belonged in presentation.
 */
export type VisualEffectKind = 'blood' | 'gore' | 'impact';

export interface VisualEffect {
	kind: VisualEffectKind;
	x: number;
	y: number;
	intensity: number;
	dir: -1 | 0 | 1;
	tint?: Tint;
}

export function effectsOf(e: CombatEvent): VisualEffect[] {
	switch (e.kind) {
		case 'hit':
			return [
				{ kind: 'blood', x: e.x, y: e.y, intensity: e.intensity, dir: e.dir },
			];
		case 'break':
			return [
				{
					kind: 'impact',
					x: e.x,
					y: e.y,
					intensity: e.intensity + COMBAT.poise.max,
					dir: e.dir,
				},
			];
		case 'death': {
			const fx: VisualEffect = {
				kind: 'gore',
				x: e.x,
				y: e.y,
				intensity: e.intensity,
				dir: e.dir,
			};
			if (e.tint !== undefined) fx.tint = e.tint;
			return [fx];
		}
		case 'swat':
			return [
				{ kind: 'impact', x: e.x, y: e.y, intensity: e.intensity, dir: e.dir },
			];
	}
}
