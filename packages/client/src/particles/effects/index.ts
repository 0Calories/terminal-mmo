import type { EffectDef } from '../profile';
import { blood } from './blood';
import { gore } from './gore';
import { impact } from './impact';
import { levelup } from './levelup';

export type EffectName = 'blood' | 'gore' | 'impact' | 'levelup';

export const EFFECTS: Record<EffectName, EffectDef> = {
	blood,
	gore,
	impact,
	levelup,
};
