import type { Effect, GameState } from '@mmo/shared';
import { activeZone, BOX } from '@mmo/shared';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
} from '@opentui/core';
import { VisualEffects } from '../effects';
import type { SoundKind } from '../sound/registry';
import { effectSoundCues } from '../sound/world';
import { type CameraState, initCameraState, stepCamera } from './camera';
import { drawPlayfield } from './scene';

export interface SoundSink {
	play(kind: SoundKind, opts?: { volume?: number; pan?: number }): void;
}

// The wall clock and Math.random are a frame's only two non-determinisms; injecting both
// is what lets the golden-frame test assert a byte-identical buffer.
export interface PlayfieldOptions extends RenderableOptions {
	now?: () => number;
	rng?: () => number;
}

export class PlayfieldRenderable extends Renderable {
	game: GameState | null = null;

	sound: SoundSink | null = null;

	private camState: CameraState = initCameraState();
	private readonly fx: VisualEffects;
	private lastParticleTick = -1;
	private lastZoneId: string | null = null;
	private lastTime = 0;
	private predicted: Effect[] = [];
	private readonly now: () => number;

	emitPredicted(effects: Effect[]): void {
		if (effects.length) this.predicted.push(...effects);
	}

	levelUpBurst(): void {
		if (!this.game) return;
		const a = this.game.player.avatar;
		this.fx.levelUpBurst(a.x + BOX.w / 2, a.y + BOX.h / 2);
	}

	// Reset on any zone change: a new zone's tick can collide with the last consumed, wedging the gate.
	private consumeSnapshotEffects(
		zoneId: string,
		tick: number,
		effects: Effect[],
	): Effect[] {
		if (zoneId !== this.lastZoneId) {
			this.lastParticleTick = -1;
			this.lastZoneId = zoneId;
		}
		const fresh = tick !== this.lastParticleTick ? effects : [];
		this.lastParticleTick = tick;
		return fresh;
	}

	constructor(ctx: RenderContext, options: PlayfieldOptions = {}) {
		const { now, rng, ...renderable } = options;
		super(ctx, { width: '100%', height: '100%', live: true, ...renderable });
		this.now = now ?? (() => performance.now());
		this.fx = new VisualEffects(rng ?? Math.random);
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (!this.game) return;
		const now = this.now();
		const dt = this.lastTime ? now - this.lastTime : 0;
		this.lastTime = now;

		// Render-only freeze: hold the last drawn frame; the sim keeps advancing in game/loop.ts.
		if (this.fx.holding()) {
			this.fx.hold(dt);
			return;
		}

		const zone = activeZone(this.game.world, this.game.player.zoneId);
		const a = this.game.player.avatar;
		this.camState = stepCamera(
			this.camState,
			this.game.player.zoneId,
			a.x,
			a.y,
			{
				sw: buffer.width,
				sh: buffer.height,
				ww: zone.terrain.w,
				wh: zone.terrain.h,
			},
		);
		const baseCam = this.camState.cam;
		if (!baseCam) return;

		const snapshotEffects = this.consumeSnapshotEffects(
			this.game.player.zoneId,
			this.game.world.tick,
			this.game.effects ?? [],
		);
		const fresh = this.predicted.length
			? [...snapshotEffects, ...this.predicted]
			: snapshotEffects;
		this.predicted = [];

		this.fx.step(dt, {
			effects: fresh,
			entities: [a, ...(this.game.others ?? [])],
			terrain: zone.terrain,
			view: { ...baseCam, w: buffer.width, h: buffer.height },
		});
		const offset = this.fx.viewOffset();
		const cam = { x: baseCam.x + offset.x, y: baseCam.y + offset.y };

		if (this.sound && fresh.length) {
			const centerX = cam.x + buffer.width / 2;
			const cues = effectSoundCues(fresh, centerX, buffer.width / 2);
			for (const cue of cues)
				this.sound.play(cue.kind, { volume: cue.volume, pan: cue.pan });
		}

		drawPlayfield(buffer, this.game, cam, this.fx);
	}
}
