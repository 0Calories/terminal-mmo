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

export type DamageNumberStyle = 'hit' | 'break' | 'avatar';

export interface DamageNumber {
	style: DamageNumberStyle;
	targetId: number;
	x: number;
	y: number;
	value: number;
	/** This number resolves the local Player's own swing: a predicted `hit`
	 *  spawns pending, and a `break` tagged with the own session converts the
	 *  pending number instead of spawning a second. */
	own: boolean;
}

export interface PresentContext {
	selfId?: number;
	avatarIds?: ReadonlySet<number>;
}

export interface Presentation {
	effects: VisualEffect[];

	kicks: (-1 | 0 | 1)[];

	hitstop: boolean;

	numbers: DamageNumber[];
}

export function present(
	events: readonly CombatEvent[],
	ctx: PresentContext = {},
): Presentation {
	const effects: VisualEffect[] = [];
	const kicks: (-1 | 0 | 1)[] = [];
	const numbers: DamageNumber[] = [];
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

	const number = (e: Extract<CombatEvent, { kind: 'hit' | 'break' }>): void => {
		const onAvatar = ctx.avatarIds?.has(e.targetId) ?? false;
		numbers.push({
			style: onAvatar ? 'avatar' : e.kind === 'break' ? 'break' : 'hit',
			targetId: e.targetId,
			x: e.x,
			y: e.y,
			value: e.intensity,
			own: ctx.selfId !== undefined && e.source === ctx.selfId,
		});
	};

	for (const e of events) {
		switch (e.kind) {
			case 'hit':
				effects.push(at(e, 'blood', e.intensity));
				number(e);
				break;
			case 'break':
				impact(e, e.intensity + COMBAT.poise.max);
				number(e);
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

	return { effects, kicks, hitstop, numbers };
}
