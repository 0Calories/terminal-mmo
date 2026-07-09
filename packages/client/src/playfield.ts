import type {
	AttackPhase,
	Effect,
	Entity,
	GameState,
	Terrain,
} from '@mmo/shared';
import {
	ACTION_FLAG,
	aabbOverlap,
	activeZone,
	BOX,
	buildSceneStyle,
	drawEntitySprite,
	drawNameplates,
	entityBox,
	guardPoseCell,
	guardPoseGlyph,
	guardRaised,
	isSolid,
	itemLabel,
	type RenderStyle,
	renderZoneScene,
	skillForSlot,
	skillHitbox,
	spriteFor,
	spriteForNpc,
	swingPhase,
	swingPose,
	swingPoseCell,
	swingProgress,
} from '@mmo/shared';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
	RGBA,
} from '@opentui/core';
import { layoutBubble } from './bubble';
import {
	applyKick,
	CAMERA_KICK,
	type CameraState,
	initCameraState,
	type Kick,
	NO_KICK,
	stepCamera,
	stepKick,
} from './camera';
import {
	type DodgeEcho,
	drawDodgeEchoes,
	isDodging,
	SAMPLE_INTERVAL_MS,
	spawnDodgeEcho,
	stepDodgeEchoes,
} from './dodge-echo';
import {
	type Hitstop,
	isFrozen,
	NO_HITSTOP,
	stepHitstop,
	triggerHitstop,
} from './hitstop';
import {
	LEVELUP,
	LEVELUP_SPECKS,
	type Particle,
	ParticleSystem,
	particleColor,
	particleDrawRow,
	particleGlyph,
	stepParticles,
} from './particles';
import type { SoundKind } from './sound/registry';
import { effectSoundCues } from './sound/world';
import { COLORS as C, RARITY_RGBA } from './theme';

export interface SoundSink {
	play(kind: SoundKind, opts?: { volume?: number; pan?: number }): void;
}

// The wall clock and Math.random are a frame's only two non-determinisms; injecting both
// is what lets the golden-frame test assert a byte-identical buffer.
export interface PlayfieldOptions extends RenderableOptions {
	now?: () => number;
	rng?: () => number;
}

const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

type BoxCell = { ch: string; fg: RGBA } | null;

interface BoxContent {
	w: number;
	h: number;
	cell(x: number, y: number): BoxCell;
}

function textContent(lines: readonly string[], fg: RGBA): BoxContent {
	return {
		w: Math.max(1, ...lines.map((l) => l.length)),
		h: lines.length,
		cell(x, y) {
			const ch = lines[y]?.[x];
			return ch && ch !== ' ' ? { ch, fg } : null;
		},
	};
}

// Terrain is a █ foreground block, so every cell must re-supply the colour already under it or terrainBg bleeds through.
function drawOverheadBox(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
	content: BoxContent,
	border: RGBA,
) {
	const sprite = spriteFor(e.type);
	const top = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const boxW = content.w + 2;
	const boxH = content.h + 2;

	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	const cx = e.x + BOX.w / 2 - cam.x;
	const tailY = top - 2;
	const tailX = Math.round(cx);
	const topY = tailY - boxH;
	let left = Math.round(cx - boxW / 2);
	left = Math.max(0, Math.min(left, sw - boxW));

	const baseAt = (px: number, py: number) =>
		isSolid(terrain, px + camX, py + camY) ? C.terrainFg : C.bg;

	for (let ry = 0; ry < boxH; ry++) {
		const py = topY + ry;
		if (py < 0 || py >= sh) continue;
		const lastRow = ry === boxH - 1;
		for (let rx = 0; rx < boxW; rx++) {
			const px = left + rx;
			if (px < 0 || px >= sw) continue;
			const lastCol = rx === boxW - 1;
			const isBorder = ry === 0 || lastRow || rx === 0 || lastCol;
			const base = baseAt(px, py);
			if (isBorder) {
				let ch = '│';
				if (ry === 0) ch = rx === 0 ? '╭' : lastCol ? '╮' : '─';
				else if (lastRow) ch = rx === 0 ? '╰' : lastCol ? '╯' : '─';
				buf.setCell(px, py, ch, border, base);
				continue;
			}
			const c = content.cell(rx - 1, ry - 1);
			if (c) {
				buf.setCell(px, py, ' ', base, base);
				buf.setCellWithAlphaBlending(px, py, c.ch, c.fg, C.bubbleBg);
			} else {
				buf.setCell(px, py, '▒', C.bubbleShade, base);
			}
		}
	}
	if (tailY >= 0 && tailY < sh && tailX >= 0 && tailX < sw)
		buf.setCell(tailX, tailY, '▼', border, baseAt(tailX, tailY));
}

function drawSpeechBubble(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
) {
	if (!e.bubble) return;
	const content = textContent(layoutBubble(e.bubble), C.bubbleFg);
	drawOverheadBox(buf, e, cam, terrain, sw, sh, content, C.bubbleBorder);
}

function drawText(
	buf: OptimizedBuffer,
	x: number,
	y: number,
	text: string,
	fg: typeof C.hud,
	sw: number,
	sh: number,
) {
	if (y < 0 || y >= sh) return;
	for (let i = 0; i < text.length; i++) {
		const px = x + i;
		if (px < 0 || px >= sw) continue;
		buf.setCellWithAlphaBlending(px, y, text[i], fg, C.transparent);
	}
}

function drawParticles(
	buf: OptimizedBuffer,
	particles: ParticleSystem,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
	keep: (p: Particle) => boolean,
) {
	// Match render.ts's projection so particleDrawRow checks solidity against the same terrain the player sees.
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	for (const p of particles.particles) {
		if (!p.active || !keep(p)) continue;
		const col = Math.round(p.x - cam.x) + camX;
		const row = particleDrawRow(
			p,
			terrain,
			col,
			Math.round(p.y - cam.y) + camY,
		);
		const px = col - camX;
		const py = row - camY;
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const c = particleColor(p);
		buf.setCellWithAlphaBlending(
			px,
			py,
			particleGlyph(p),
			RGBA.fromInts(c.r, c.g, c.b, c.a),
			C.transparent,
		);
	}
}

function swingRenderState(
	e: Entity,
): { phase: AttackPhase; progress: number } | null {
	if (e.action && e.action.move !== 'idle')
		return { phase: e.action.phase, progress: e.action.progress };
	const phase = swingPhase(e.attackT);
	return phase ? { phase, progress: swingProgress(e.attackT) } : null;
}

function drawSwing(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (e.weapon !== undefined) return;
	const st = swingRenderState(e);
	if (!st) return;
	const move = e.action && e.action.move !== 'idle' ? e.action.move : 'basic';
	const pose = swingPose(move, st.phase, e.facing);
	if (!pose) return;
	const cell = swingPoseCell(e, st.phase);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			pose.glyph,
			C.telegraph,
			C.transparent,
		);
}

function isGuarding(e: Entity): boolean {
	if (e.action) return (e.action.flags & ACTION_FLAG.guarding) !== 0;
	return guardRaised(e.guardT ?? 0);
}

function drawGuard(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!isGuarding(e)) return;
	const cell = guardPoseCell(e);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			guardPoseGlyph(),
			C.guard,
			C.transparent,
		);
}

function drawPlayfield(
	buf: OptimizedBuffer,
	game: GameState,
	cam: { x: number; y: number },
	particles: ParticleSystem,
	dodgeEchoes: readonly DodgeEcho[],
) {
	const { player } = game;
	const zone = activeZone(game.world, player.zoneId);
	const sw = buf.width;
	const sh = buf.height;
	const p = player.avatar;
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	const others = game.others ?? [];
	const npcs = zone.npcs ?? [];

	renderZoneScene(
		buf,
		{
			terrain: zone.terrain,
			portals: zone.portals,
			npcs,
			entities: [...zone.monsters, ...others],
		},
		cam,
		STYLE,
	);

	// Resting/fading blood behind the Sprites (airborne blood is drawn in front, below).
	drawParticles(
		buf,
		particles,
		cam,
		zone.terrain,
		sw,
		sh,
		(p) => p.stage !== 'airborne',
	);

	const onPortal = zone.portals.find((pr) => aabbOverlap(entityBox(p), pr));
	if (onPortal) {
		const dest = game.world.zones[onPortal.target]?.type ?? 'zone';
		const label = `↵ e  enter the ${dest.charAt(0).toUpperCase()}${dest.slice(1)}`;
		drawText(
			buf,
			Math.round(onPortal.x) - camX,
			Math.round(onPortal.y) - camY - 1,
			label,
			C.portal,
			sw,
			sh,
		);
	}
	const onNpc = npcs.find((n) => aabbOverlap(entityBox(p), n));
	if (onNpc) {
		const sprite = spriteForNpc(onNpc.kind);
		const sx =
			Math.round(onNpc.x + Math.floor((onNpc.w - sprite.w) / 2)) - camX;
		const sy = Math.round(onNpc.y + onNpc.h - sprite.h) - camY;
		if (onNpc.kind === 'signpost' && onNpc.lines && onNpc.lines.length > 0) {
			const lines = onNpc.lines;
			lines.forEach((line, i) => {
				drawText(buf, sx, sy - lines.length + i, line, C.signpost, sw, sh);
			});
		} else {
			drawText(buf, sx, sy - 1, `↵ e  talk to ${onNpc.name}`, C.vendor, sw, sh);
		}
	}

	for (const d of zone.drops ?? []) {
		const col = RARITY_RGBA[d.item.rarity];
		const gx = Math.round(d.x + d.w / 2) - camX;
		const gy = Math.round(d.y + d.h - 1) - camY;
		if (gx >= 0 && gx < sw && gy >= 0 && gy < sh)
			buf.setCellWithAlphaBlending(gx, gy, '◆', col, C.transparent);
		const label = itemLabel(d.item);
		drawText(
			buf,
			gx - Math.floor(label.length / 2),
			gy - 1,
			label,
			col,
			sw,
			sh,
		);
	}

	for (const e of others) {
		drawSwing(buf, e, cam, sw, sh);
		drawGuard(buf, e, cam, sw, sh);
	}

	for (const m of zone.monsters) drawSwing(buf, m, cam, sw, sh);

	// Flash only just after the skill fires, mirroring the melee flash window.
	for (let slot = 1; ; slot++) {
		const skill = skillForSlot(player.class ?? 'warrior', slot);
		if (!skill) break;
		const cd = player.skillCooldowns?.[skill.id] ?? 0;
		if (cd <= skill.cooldown - 0.15) continue;
		const hb = skillHitbox(p, skill);
		for (let yy = 0; yy < hb.h; yy++) {
			for (let xx = 0; xx < hb.w; xx++) {
				const px = Math.round(hb.x + xx - cam.x);
				const py = Math.round(hb.y + yy - cam.y);
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(px, py, '✦', C.telegraph, C.transparent);
			}
		}
	}

	drawDodgeEchoes(buf, dodgeEchoes, cam, sw, sh);

	// The local Avatar drawn last, on top of everyone.
	drawEntitySprite(buf, p, cam, STYLE, zone.terrain);
	drawSwing(buf, p, cam, sw, sh);
	drawGuard(buf, p, cam, sw, sh);

	// Airborne blood in front of the Sprites, still below the over-head bubbles so chat stays legible.
	drawParticles(
		buf,
		particles,
		cam,
		zone.terrain,
		sw,
		sh,
		(pt) => pt.stage === 'airborne',
	);

	drawNameplates(buf, others, cam, zone.terrain, STYLE);

	for (const e of others) drawSpeechBubble(buf, e, cam, zone.terrain, sw, sh);
	drawSpeechBubble(buf, p, cam, zone.terrain, sw, sh);

	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		buf.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}
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

		// Render-only freeze: hold the last drawn frame; the sim keeps advancing in index.ts.
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
