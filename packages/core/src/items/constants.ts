import { BOX } from '../entities/archetypes';

export const LOOT = {
	pickup: { w: BOX.w + 4, h: BOX.h },
	ttlSec: 30,
} as const;
