// particles — the client particle engine. Its ONLY public surface is named
// effects (ADR 0013 amendment): `spawn('blood' | 'gore' | 'impact' |
// 'levelup', at, dir, intensity)`. Each effect is one definition file under
// ./effects owning every knob; raw physics profiles are module-internal, so
// no caller can construct or pass one. Terrain collision resolves through
// core physics' shared sweep — the engine has no collision code of its own.

import type { Terrain, Tint } from '@mmo/core/entities';
import type { OptimizedBuffer } from '@opentui/core';
import { drawSpecks } from './draw';
import { EFFECTS, type EffectName } from './effects';
import { advanceSpecks, Pool, spawnSpeck } from './engine';

export type { EffectName };

// Where in the scene's paint order a layer sits: settled blood behind the
// Sprites, airborne specks in front (dodge echoes are their own module).
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

	/** Burst a named effect: the effect's own count-from-intensity curve decides how many specks. */
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

	/** Drop every live speck — the zone-change reset (#373): old-zone specks never sim against new-zone terrain. */
	clear(): void {
		this.pool.clear();
	}

	/** Advance every live speck one render frame against the frame's terrain. */
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
