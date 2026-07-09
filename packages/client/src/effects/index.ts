import type { Entity, Terrain } from '@mmo/core';
import type { OptimizedBuffer } from '@opentui/core';
import {
	applyKick,
	CAMERA_KICK,
	type Kick,
	NO_KICK,
	stepKick,
} from './camera-kick';
import { DodgeTracker } from './dodge-echo';
import { drawParticles } from './draw-particles';
import {
	type Hitstop,
	isFrozen,
	NO_HITSTOP,
	stepHitstop,
	triggerHitstop,
} from './hitstop';
import { advanceParticles, ParticleSystem } from './particles';
import type { VisualEffect } from './project';
import { LEVELUP, LEVELUP_SPECKS, REALIZE, spawnEffects } from './realize';

// Where in the scene's paint order a draw call sits: settled blood behind the
// Sprites, dodge echoes between them, airborne specks in front.
export type EffectLayer = 'settled' | 'echoes' | 'airborne';

export interface EffectFrame {
	// The frame's fresh VisualEffects — already projected (see effects/project.ts,
	// ADR 0029) from snapshot-gated plus locally predicted CombatEvents, each seen once.
	effects: readonly VisualEffect[];
	// Everyone visible this frame, for dodge-echo tracking.
	entities: readonly Entity[];
	terrain: Terrain;
	// The base (un-kicked) camera and view size; spawns off this view are culled.
	view: { x: number; y: number; w: number; h: number };
}

/**
 * The VisualEffect facade: the whole client-side realization of combat
 * presentation — particles, camera-kick, hitstop, dodge echoes — behind one
 * surface. Callers express intent (`step` a frame, `levelUpBurst`); render only
 * asks for the view state (`holding`, `viewOffset`) and paints layers (`draw`).
 * No caller ever sees a particle.
 */
export class VisualEffects {
	private readonly particles: ParticleSystem;
	private readonly dodges = new DodgeTracker();
	private kick: Kick = NO_KICK;
	private hitstop: Hitstop = NO_HITSTOP;
	private terrain: Terrain | null = null;

	constructor(
		private readonly rng: () => number,
		poolSize?: number,
	) {
		this.particles = new ParticleSystem(poolSize);
	}

	// True while a hitstop freeze wants the last drawn frame held.
	holding(): boolean {
		return isFrozen(this.hitstop);
	}

	// A held frame's only motion: the freeze itself decays on real wall time.
	hold(dtMs: number): void {
		this.hitstop = stepHitstop(this.hitstop, dtMs);
	}

	// The camera-kick to add on top of the follow camera this frame.
	viewOffset(): { x: number; y: number } {
		return this.kick;
	}

	/** Realize the frame's Effects and advance everything one frame. */
	step(dtMs: number, frame: EffectFrame): void {
		this.terrain = frame.terrain;
		for (const fx of frame.effects) {
			const realization = REALIZE[fx.kind];
			if (!realization) continue;
			if (realization.kick)
				this.kick = applyKick(this.kick, fx.dir * CAMERA_KICK.maxCells, -1);
			if (realization.hitstop) this.hitstop = triggerHitstop(this.hitstop);
		}
		this.kick = stepKick(this.kick, dtMs);

		const cam = {
			x: frame.view.x + this.kick.x,
			y: frame.view.y + this.kick.y,
			w: frame.view.w,
			h: frame.view.h,
		};
		spawnEffects(this.particles, frame.effects, this.rng, cam);
		advanceParticles(this.particles, dtMs, frame.terrain);

		this.dodges.update(frame.entities, dtMs);
	}

	levelUpBurst(cx: number, cy: number): void {
		for (let i = 0; i < LEVELUP_SPECKS; i++)
			this.particles.spawn(LEVELUP, cx, cy, 0, this.rng);
	}

	draw(
		buf: OptimizedBuffer,
		cam: { x: number; y: number },
		layer: EffectLayer,
	): void {
		if (layer === 'echoes') {
			this.dodges.draw(buf, cam, buf.width, buf.height);
			return;
		}
		if (!this.terrain) return;
		drawParticles(
			buf,
			this.particles,
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
