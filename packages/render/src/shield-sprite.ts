import type { Sprite } from './sprite';

export interface ShieldSprite {
	frames: {
		rest: Sprite;
		block: readonly Sprite[];
	};
	grip: { x: number; y: number };
	blockFps?: number;
}
