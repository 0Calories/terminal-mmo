import type {
	AvatarSnapshot,
	ClientMessage,
	Effect,
	Entity,
	GameState,
	Input,
	Zone,
} from '@mmo/core';
import { activeZone } from '@mmo/core';
import type { Bubble } from '../net/net';
import { snapshotToGame } from '../net/net';
import type { SoundKind } from '../sound/registry';
import { jumpStarted, landed, leveledUp } from '../sound/triggers';
import {
	applyEmote,
	arriveInZone,
	predictSwingEffects,
	reconcileHealth,
	spawnPredicted,
	stepPrediction,
} from './predict';

const SEND_INTERVAL = 1000 / 30;

const IDLE_INPUT: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

type Snapshot = Parameters<typeof snapshotToGame>[3];

interface InputSource {
	poll(now: number): Input;
	consumeInteract(): boolean;
}

// The slices of the client's collaborators the loop actually touches.
interface NetView {
	readonly sessionId: number;
	readonly zoneId: string;
	readonly latest: Snapshot;
	readonly chatLog: string[];
	readonly bubbles: ReadonlyMap<number, Bubble>;
	ownAvatar(): AvatarSnapshot | undefined;
	sample(nowMs: number): Snapshot;
	decayBubbles(dtSec: number): void;
	send(msg: ClientMessage): void;
}

interface PlayfieldView {
	game: GameState | null;
	emitPredicted(effects: Effect[]): void;
	levelUpBurst(): void;
}

interface HudView {
	update(game: GameState, fps: number): void;
	syncChat(lines: string[]): void;
	flashLevelUp(): void;
}

interface SoundView {
	play(kind: SoundKind): void;
}

export interface GameLoopDeps {
	net: NetView;
	input: InputSource;
	hud: HudView;
	playfield: PlayfieldView;
	sound: SoundView;
	localZone(id: string): Zone;
	weapon: number;
	// A modal swallows movement: the Avatar idles while a menu or the chat line has focus.
	modalOpen(): boolean;
	// Run after the frame's game state is built — the HUD-adjacent views that mirror it.
	syncViews(): void;
}

function fpsMeter() {
	let fps = 0;
	let acc = 0;
	let frames = 0;
	return (dt: number) => {
		acc += dt;
		frames++;
		if (acc >= 500) {
			fps = Math.round((frames * 1000) / acc);
			acc = 0;
			frames = 0;
		}
		return fps;
	};
}

/**
 * The client's per-frame tick: poll input, predict the local Avatar forward, send the
 * prediction upstream on a fixed cadence, and hand the fused state to the renderer.
 * Owns the predicted Avatar — the one piece of game state the client authors itself.
 */
export class GameLoop {
	private zoneId = 'field-01';
	private zone: Zone;
	private predicted: Entity;
	private sendAcc = 0;
	private readonly meter = fpsMeter();
	// null until the first snapshot so a reconnect at an already-high level can't false-trigger.
	private prevLevel: number | null = null;

	constructor(private readonly deps: GameLoopDeps) {
		this.zone = deps.localZone(this.zoneId);
		this.predicted = spawnPredicted(deps.weapon);
	}

	get currentZone(): Zone {
		return this.zone;
	}

	get avatar(): Entity {
		return this.predicted;
	}

	emote(emote: string): void {
		this.predicted = applyEmote(this.predicted, emote);
	}

	frame = (dt: number): void => {
		const { net, input, hud, playfield, sound } = this.deps;
		const modalActive = this.deps.modalOpen();
		const inp = modalActive ? IDLE_INPUT : input.poll(performance.now());

		if (net.zoneId && net.zoneId !== this.zoneId) {
			this.zoneId = net.zoneId;
			this.zone = this.deps.localZone(this.zoneId);
			const arrival = net.ownAvatar();
			if (arrival) this.predicted = arriveInZone(this.predicted, arrival);
		}

		const level = net.latest?.progress.level ?? 1;
		const prev = this.predicted;
		const step = stepPrediction(prev, inp, {
			terrain: this.zone.terrain,
			level,
			dtMs: dt,
		});
		this.predicted = step.avatar;
		if (jumpStarted(prev, this.predicted)) sound.play('jump');
		if (landed(prev, this.predicted)) sound.play('land');

		const own = net.ownAvatar();
		if (own) reconcileHealth(this.predicted, own);

		this.sendAcc += dt;
		if (this.sendAcc >= SEND_INTERVAL) {
			this.sendAcc = 0;
			const interact = input.consumeInteract();
			net.send({
				t: 'input',
				x: this.predicted.x,
				y: this.predicted.y,
				vx: this.predicted.vx,
				vy: this.predicted.vy,
				facing: this.predicted.facing,
				onGround: this.predicted.onGround,
				attack: inp.attack,
				guard: inp.guard ?? false,
				interact: modalActive ? false : interact,
				dodge: step.dodging,
				skill: inp.skill,
			});
		}

		const fps = this.meter(dt);
		const view = net.sample(performance.now());
		net.decayBubbles(dt / 1000);
		const game = snapshotToGame(
			this.zone,
			this.predicted,
			net.sessionId,
			view,
			this.predicted.skillCooldowns ?? {},
			net.bubbles,
		);
		playfield.game = game;

		const snapLevel = net.latest?.progress.level;
		if (snapLevel != null) {
			if (this.prevLevel != null && leveledUp(this.prevLevel, snapLevel)) {
				sound.play('level-up');
				playfield.levelUpBurst();
				hud.flashLevelUp();
			}
			this.prevLevel = snapLevel;
		}

		if (step.hitbox) {
			const monsters = activeZone(game.world, game.player.zoneId).monsters;
			playfield.emitPredicted(
				predictSwingEffects(
					this.predicted,
					step.hitbox,
					step.hitDamage,
					monsters,
				),
			);
		}

		hud.update(game, fps);
		hud.syncChat(net.chatLog);
		this.deps.syncViews();
	};
}
