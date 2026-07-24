import { BOX } from '../entities/body';

export const LOOT = {
	pickup: { w: BOX.w + 4, h: BOX.h },
	ttlSec: 30,
} as const;
