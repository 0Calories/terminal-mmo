import type { CombatEvent } from '@mmo/core/combat';
import { BOX } from '@mmo/core/entities';
import { activeZone, type GameState } from '@mmo/core/protocol';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
} from '@opentui/core';
import {
	type Hitstop,
	isFrozen,
	NO_HITSTOP,
	stepHitstop,
	triggerHitstop,
} from '../game/hitstop';
import { ParticleEngine } from '../particles';
import type { SoundKind } from '../sound/registry';
import { effectSoundCues } from '../sound/world';
import {
	applyKick,
	CAMERA_KICK,
	type CameraState,
	initCameraState,
	inView,
	type Kick,
	NO_KICK,
	stepCamera,
	stepKick,
} from './camera';
import { DodgeTracker } from './dodge-echo';
import { present } from './present';
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

/**
 * The render-side composition point: each frame it routes the fresh
 * CombatEvents through `present` once, then steps the independent feel
 * systems — particles, camera kick, hitstop, dodge echoes — side by side
 * (ADR 0013 amendment: no shared facade object between them).
 */
export class PlayfieldRenderable extends Renderable {
	game: GameState | null = null;

	sound: SoundSink | null = null;

	private camState: CameraState = initCameraState();
	private kick: Kick = NO_KICK;
	private hitstop: Hitstop = NO_HITSTOP;
	private readonly particles: ParticleEngine;
	private readonly dodges = new DodgeTracker();
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
		this.particles.spawn(
			'levelup',
			{ x: a.x + BOX.w / 2, y: a.y + BOX.h / 2 },
			0,
			0,
		);
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
		this.particles = new ParticleEngine(rng ?? Math.random);
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (!this.game) return;
		const now = this.now();
		const dt = this.lastTime ? now - this.lastTime : 0;
		this.lastTime = now;

		// Render-only freeze: hold the last drawn frame; the sim keeps advancing in game/loop.ts.
		if (isFrozen(this.hitstop)) {
			this.hitstop = stepHitstop(this.hitstop, dt);
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

		// The one routing pass (ADR 0029 / ADR 0013 amendment): fold this frame's
		// CombatEvents (snapshot-gated + locally predicted) into presentation exactly once.
		const show = present(fresh);

		for (const dir of show.kicks)
			this.kick = applyKick(this.kick, dir * CAMERA_KICK.maxCells, -1);
		if (show.hitstop) this.hitstop = triggerHitstop(this.hitstop);
		this.kick = stepKick(this.kick, dt);

		const cam = { x: baseCam.x + this.kick.x, y: baseCam.y + this.kick.y };
		const view = { ...cam, w: buffer.width, h: buffer.height };
		for (const fx of show.effects)
			if (inView(view, fx.x, fx.y))
				this.particles.spawn(fx.kind, fx, fx.dir, fx.intensity, fx.tint);
		this.particles.step(dt, zone.terrain);

		this.dodges.update([a, ...(this.game.others ?? [])], dt);

		if (this.sound && show.effects.length) {
			const centerX = cam.x + buffer.width / 2;
			const cues = effectSoundCues(show.effects, centerX, buffer.width / 2);
			for (const cue of cues)
				this.sound.play(cue.kind, { volume: cue.volume, pan: cue.pan });
		}

		drawPlayfield(buffer, this.game, cam, {
			particles: this.particles,
			dodges: this.dodges,
		});
	}
}
