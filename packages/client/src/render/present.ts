// The stateless routing layer (ADR 0013 amendment, collapsing the old
// projection + realization pair): the ONE place a server-or-predicted
// CombatEvent becomes client presentation — which named particle effect to
// burst, and whether the moment also punches the camera and freezes the
// redraw. Nothing else in the client knows that a `break` means impact +
// kick + hitstop together. It retires the on-wire Effect (ADR 0029): the
// server broadcasts semantic events and each client routes them locally,
// dropping server-internal fields (like `hit`'s echo-suppression `source`)
// that never belonged in presentation.

import { COMBAT, type CombatEvent } from '@mmo/core/combat';
import type { Tint } from '@mmo/core/entities';

// The combat-routable subset of the particle engine's named effects
// ('levelup' is spawned by intent from the game loop, never from an event).
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
	/** One camera punch per big moment, along the hit direction. */
	kicks: (-1 | 0 | 1)[];
	/** Freeze the redraw for a beat (render pacing, owned by the frame loop). */
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

	// An impact is the "big moment" treatment: the burst plus a camera punch
	// and a redraw freeze, together.
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
				// A swat clinks with the full impact treatment — kick and hitstop
				// included, exactly what the light clink got pre-rebuild (the old
				// REALIZE map gave every impact both).
				impact(e, e.intensity);
				break;
		}
	}

	return { effects, kicks, hitstop };
}
