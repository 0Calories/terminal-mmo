import { BOX } from '../entities/archetypes';

export const WORLD = { w: 240, h: 40 } as const;
export const GROUND_TOP = WORLD.h - 3;

export const NPC_BOX = { w: 4, h: BOX.h } as const; // must match world.ts's Merchant footprint
export const PORTAL_BOX = { w: 4, h: 7 } as const; // must match world.ts's portal dims

export const SPAWN = { x: 10, y: GROUND_TOP - BOX.h } as const;

export const TOWN = { w: 80 } as const;

export const TOWN_SPAWN = { x: 12, y: GROUND_TOP - BOX.h } as const;

export const RESPAWN = { delaySec: 5 } as const;
