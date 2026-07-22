import { COMBAT, type CombatEvent } from '@mmo/core/combat';
import type { Tint } from '@mmo/core/entities';

export type VisualEffectKind = 'blood' | 'gore' | 'impact';

export interface VisualEffect {
	kind: VisualEffectKind;
	x: number;
	y: number;
	intensity: number;
	dir: -1 | 0 | 1;
	tint?: Tint;
}

export interface Presentation {
	effects: VisualEffect[];

	kicks: (-1 | 0 | 1)[];

	hitstop: boolean;
}

export function present(events: readonly CombatEvent[]): Presentation {
	const effects: VisualEffect[] = [];
	const kicks: (-1 | 0 | 1)[] = [];
	let hitstop = false;

	const at = (
		e: CombatEvent,
		kind: VisualEffectKind,
		intensity: number,
	): VisualEffect => ({ kind, x: e.x, y: e.y, intensity, dir: e.dir });

	const impact = (e: CombatEvent, intensity: number): void => {
		effects.push(at(e, 'impact', intensity));
		kicks.push(e.dir);
		hitstop = true;
	};

	for (const e of events) {
		switch (e.kind) {
			case 'hit':
				effects.push(at(e, 'blood', e.intensity));
				break;
			case 'break':
				impact(e, e.intensity + COMBAT.poise.max);
				break;
			case 'death': {
				const fx = at(e, 'gore', e.intensity);
				if (e.tint !== undefined) fx.tint = e.tint;
				effects.push(fx);
				break;
			}
			case 'swat':
				impact(e, e.intensity);
				break;
		}
	}

	return { effects, kicks, hitstop };
}
