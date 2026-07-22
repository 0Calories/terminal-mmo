import type { Terrain, Tint } from '@mmo/core/entities';
import type { OptimizedBuffer } from '@opentui/core';
import { drawSpecks } from './draw';
import { EFFECTS, type EffectName } from './effects';
import { advanceSpecks, Pool, spawnSpeck } from './engine';

export type { EffectName };

export type ParticleLayer = 'settled' | 'airborne';

export class ParticleEngine {
	private readonly pool: Pool;
	private terrain: Terrain | null = null;

	constructor(
		private readonly rng: () => number,
		poolSize?: number,
	) {
		this.pool = new Pool(poolSize);
	}

	get activeCount(): number {
		return this.pool.activeCount;
	}

	spawn(
		effect: EffectName,
		at: { x: number; y: number },
		dir: -1 | 0 | 1,
		intensity: number,
		tint?: Tint,
	): void {
		const def = EFFECTS[effect];
		const count = def.count(intensity);
		for (let i = 0; i < count; i++)
			spawnSpeck(this.pool, def.profile, at.x, at.y, dir, this.rng, tint);
	}

	clear(): void {
		this.pool.clear();
	}

	step(dtMs: number, terrain: Terrain): void {
		this.terrain = terrain;
		advanceSpecks(this.pool, dtMs, terrain);
	}

	draw(
		buf: OptimizedBuffer,
		cam: { x: number; y: number },
		layer: ParticleLayer,
	): void {
		if (!this.terrain) return;
		drawSpecks(
			buf,
			this.pool,
			cam,
			this.terrain,
			buf.width,
			buf.height,
			layer === 'airborne'
				? (p) => p.stage === 'airborne'
				: (p) => p.stage !== 'airborne',
		);
	}
}
