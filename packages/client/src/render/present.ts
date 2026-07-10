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

	for (const e of events) {
		switch (e.kind) {
			case 'hit':
				effects.push({
					kind: 'blood',
					x: e.x,
					y: e.y,
					intensity: e.intensity,
					dir: e.dir,
				});
				break;
			case 'break':
				effects.push({
					kind: 'impact',
					x: e.x,
					y: e.y,
					intensity: e.intensity + COMBAT.poise.max,
					dir: e.dir,
				});
				kicks.push(e.dir);
				hitstop = true;
				break;
			case 'death': {
				const fx: VisualEffect = {
					kind: 'gore',
					x: e.x,
					y: e.y,
					intensity: e.intensity,
					dir: e.dir,
				};
				if (e.tint !== undefined) fx.tint = e.tint;
				effects.push(fx);
				break;
			}
			case 'swat':
				effects.push({
					kind: 'impact',
					x: e.x,
					y: e.y,
					intensity: e.intensity,
					dir: e.dir,
				});
				kicks.push(e.dir);
				hitstop = true;
				break;
		}
	}

	return { effects, kicks, hitstop };
}
