import type { CombatEvent, GameState } from '@mmo/core';
import { activeZone, BOX } from '@mmo/core';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
} from '@opentui/core';
import { VisualEffects } from '../effects';
import { effectsOf } from '../effects/project';
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
	private readonly visuals: VisualEffects;
	private lastParticleTick = -1;
	private lastZoneId: string | null = null;
	private lastTime = 0;
	private predicted: CombatEvent[] = [];
	private readonly now: () => number;

	emitPredicted(events: CombatEvent[]): void {
		if (events.length) this.predicted.push(...events);
	}

	levelUpBurst(): void {
		if (!this.game) return;
		const a = this.game.player.avatar;
		this.visuals.levelUpBurst(a.x + BOX.w / 2, a.y + BOX.h / 2);
	}

	// Reset on any zone change: a new zone's tick can collide with the last consumed, wedging the gate.
	private consumeSnapshotEvents(
		zoneId: string,
		tick: number,
		events: CombatEvent[],
	): CombatEvent[] {
		if (zoneId !== this.lastZoneId) {
			this.lastParticleTick = -1;
			this.lastZoneId = zoneId;
		}
		const fresh = tick !== this.lastParticleTick ? events : [];
		this.lastParticleTick = tick;
		return fresh;
	}

	constructor(ctx: RenderContext, options: PlayfieldOptions = {}) {
		const { now, rng, ...renderable } = options;
		super(ctx, { width: '100%', height: '100%', live: true, ...renderable });
		this.now = now ?? (() => performance.now());
		this.visuals = new VisualEffects(rng ?? Math.random);
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (!this.game) return;
		const now = this.now();
		const dt = this.lastTime ? now - this.lastTime : 0;
		this.lastTime = now;

		// Render-only freeze: hold the last drawn frame; the sim keeps advancing in game/loop.ts.
		if (this.visuals.holding()) {
			this.visuals.hold(dt);
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

		const snapshotEvents = this.consumeSnapshotEvents(
			this.game.player.zoneId,
			this.game.world.tick,
			this.game.events ?? [],
		);
		const fresh = this.predicted.length
			? [...snapshotEvents, ...this.predicted]
			: snapshotEvents;
		this.predicted = [];

		// The client-side projection point (ADR 0029): fold this frame's CombatEvents
		// (snapshot-gated + locally predicted) into VisualEffects exactly once.
		const projected = fresh.flatMap(effectsOf);

		this.visuals.step(dt, {
			effects: projected,
			entities: [a, ...(this.game.others ?? [])],
			terrain: zone.terrain,
			view: { ...baseCam, w: buffer.width, h: buffer.height },
		});
		const offset = this.visuals.viewOffset();
		const cam = { x: baseCam.x + offset.x, y: baseCam.y + offset.y };

		if (this.sound && projected.length) {
			const centerX = cam.x + buffer.width / 2;
			const cues = effectSoundCues(projected, centerX, buffer.width / 2);
			for (const cue of cues)
				this.sound.play(cue.kind, { volume: cue.volume, pan: cue.pan });
		}

		drawPlayfield(buffer, this.game, cam, this.visuals);
	}
}
