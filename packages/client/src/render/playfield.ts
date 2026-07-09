import type { Effect, Entity, GameState } from '@mmo/shared';
import { activeZone, BOX } from '@mmo/shared';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
} from '@opentui/core';
import {
	applyKick,
	CAMERA_KICK,
	type Kick,
	NO_KICK,
	stepKick,
} from '../effects/camera-kick';
import {
	type DodgeEcho,
	isDodging,
	SAMPLE_INTERVAL_MS,
	spawnDodgeEcho,
	stepDodgeEchoes,
} from '../effects/dodge-echo';
import {
	type Hitstop,
	isFrozen,
	NO_HITSTOP,
	stepHitstop,
	triggerHitstop,
} from '../effects/hitstop';
import {
	LEVELUP,
	LEVELUP_SPECKS,
	ParticleSystem,
	stepParticles,
} from '../effects/particles';
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

type DodgeTrack = {
	x: number;
	y: number;
	facing: Entity['facing'];
	dodging: boolean;
	sinceSampleMs: number;
};

export class PlayfieldRenderable extends Renderable {
	game: GameState | null = null;

	sound: SoundSink | null = null;

	private camState: CameraState = initCameraState();
	private kick: Kick = NO_KICK;
	private hitstop: Hitstop = NO_HITSTOP;
	private particles = new ParticleSystem();
	private lastParticleTick = -1;
	private lastZoneId: string | null = null;
	private lastTime = 0;
	private dodgeEchoes: DodgeEcho[] = [];
	private dodgeTrack = new Map<number, DodgeTrack>();
	private predicted: Effect[] = [];
	private readonly now: () => number;
	private readonly rng: () => number;

	emitPredicted(effects: Effect[]): void {
		if (effects.length) this.predicted.push(...effects);
	}

	levelUpBurst(): void {
		if (!this.game) return;
		const a = this.game.player.avatar;
		const cx = a.x + BOX.w / 2;
		const cy = a.y + BOX.h / 2;
		for (let i = 0; i < LEVELUP_SPECKS; i++)
			this.particles.spawn(LEVELUP, cx, cy, 0, this.rng);
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
		this.rng = rng ?? Math.random;
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

		const snapshotEffects = this.consumeSnapshotEffects(
			this.game.player.zoneId,
			this.game.world.tick,
			this.game.effects ?? [],
		);
		const fresh = this.predicted.length
			? [...snapshotEffects, ...this.predicted]
			: snapshotEffects;
		this.predicted = [];

		for (const fx of fresh)
			if (fx.kind === 'impact') {
				this.kick = applyKick(this.kick, fx.dir * CAMERA_KICK.maxCells, -1);
				this.hitstop = triggerHitstop(this.hitstop);
			}
		this.kick = stepKick(this.kick, dt);
		const cam = { x: baseCam.x + this.kick.x, y: baseCam.y + this.kick.y };

		stepParticles(this.particles, fresh, dt, zone.terrain, this.rng, {
			x: cam.x,
			y: cam.y,
			w: buffer.width,
			h: buffer.height,
		});

		const nextTrack = new Map<number, DodgeTrack>();
		for (const e of [a, ...(this.game.others ?? [])]) {
			const dodging = isDodging(e);
			const prev = this.dodgeTrack.get(e.id);
			const started = dodging && !prev?.dodging;
			let sinceSampleMs = (prev?.sinceSampleMs ?? 0) + dt;
			if (started) {
				spawnDodgeEcho(this.dodgeEchoes, {
					x: prev?.x ?? e.x,
					y: prev?.y ?? e.y,
					facing: e.facing,
					type: e.type,
				});
				sinceSampleMs = 0;
			} else if (dodging && sinceSampleMs >= SAMPLE_INTERVAL_MS) {
				spawnDodgeEcho(this.dodgeEchoes, {
					x: e.x,
					y: e.y,
					facing: e.facing,
					type: e.type,
				});
				sinceSampleMs = 0;
			}
			nextTrack.set(e.id, {
				x: e.x,
				y: e.y,
				facing: e.facing,
				dodging,
				sinceSampleMs,
			});
		}
		this.dodgeTrack = nextTrack;
		this.dodgeEchoes = stepDodgeEchoes(this.dodgeEchoes, dt);

		if (this.sound && fresh.length) {
			const centerX = cam.x + buffer.width / 2;
			const cues = effectSoundCues(fresh, centerX, buffer.width / 2);
			for (const cue of cues)
				this.sound.play(cue.kind, { volume: cue.volume, pan: cue.pan });
		}

		drawPlayfield(buffer, this.game, cam, this.particles, this.dodgeEchoes);
	}
}
