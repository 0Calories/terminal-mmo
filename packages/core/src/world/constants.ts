import { BOX } from '../entities/archetypes';
import { GROUND_TOP } from '../zones/constants';

// Where a forgiving death lands: the Town's safe arrival point.
export const TOWN_SPAWN = { x: 12, y: GROUND_TOP - BOX.h } as const;
