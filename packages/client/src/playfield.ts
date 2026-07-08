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

// The minimal audio sink the playfield needs. An interface so the render path depends on
// the SoundSystem's surface, not its construction.
export interface SoundSink {
	play(kind: SoundKind, opts?: { volume?: number; pan?: number }): void;
}

// Colour binding for the shared renderer, resolved from the shared scene colour DATA so
// the game and the forge preview render from one source and can't drift (#56).
const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// One interior cell of an over-head box. A `null` cell is blank — interior padding (a
// frosted `▒` shade, ADR 0016).
type BoxCell = { ch: string; fg: RGBA } | null;

// The grid an over-head box frames. Chat text and emote pixel-art both reduce to this.
interface BoxContent {
	w: number;
	h: number;
	cell(x: number, y: number): BoxCell;
}

// Word-wrapped chat text as box content, each char in the sender's colour (#59, ADR 0007).
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

// The shared over-head box behind the chat Speech bubble (#59, ADR 0007) and the emote
// (#38): a bordered box with a tail, re-projected through the camera each frame and
// x-clamped to the viewport. The gotcha: terrain is a `█` FOREGROUND block, so any glyph
// the box draws replaces it — every cell must re-supply the colour ALREADY under it
// (terrain `terrainFg` or sky `bg`, ADR 0016) or the dark `terrainBg` shows through (the
// "tint spilling outside the border" bug).
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
	// Tail tip sits one row above the nameplate (which is at top - 1); the box bottom
	// border is just above the tail.
	const tailY = top - 2;
	const tailX = Math.round(cx);
	const topY = tailY - boxH;
	let left = Math.round(cx - boxW / 2);
	left = Math.max(0, Math.min(left, sw - boxW)); // keep the whole box on screen

	// The colour already on screen at a cell: terrain block, or sky.
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
				// Frame glyph over the sampled base — no bleed outside the border.
				let ch = '│';
				if (ry === 0) ch = rx === 0 ? '╭' : lastCol ? '╮' : '─';
				else if (lastRow) ch = rx === 0 ? '╰' : lastCol ? '╯' : '─';
				buf.setCell(px, py, ch, border, base);
				continue;
			}
			const c = content.cell(rx - 1, ry - 1);
			if (c) {
				// Behind text: bright glyph on a ~50% dark backing over the base.
				buf.setCell(px, py, ' ', base, base);
				buf.setCellWithAlphaBlending(px, py, c.ch, c.fg, C.bubbleBg);
			} else {
				// Interior padding: a frosted `▒` shade dithering the base.
				buf.setCell(px, py, '▒', C.bubbleShade, base);
			}
		}
	}
	if (tailY >= 0 && tailY < sh && tailX >= 0 && tailX < sw)
		buf.setCell(tailX, tailY, '▼', border, baseAt(tailX, tailY));
}

// The latest Chat line, word-wrapped, in the shared over-head box (#59, ADR 0007).
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

// Blit every active speck the `keep` filter selects, alpha-blended so overlapping blood
// reads denser. Colour + glyph come from the pure particle helpers (ADR 0013).
function drawParticles(
	buf: OptimizedBuffer,
	particles: ParticleSystem,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
	keep: (p: Particle) => boolean,
) {
	// Match the terrain layer's projection (render.ts) and resolve the draw cell in world
	// space, so particleDrawRow checks solidity against the SAME terrain the player sees.
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

// The swing an entity is rendering, or null. Co-present entities carry the authoritative
// `action` (ADR 0017 §10); the local Avatar has none, so its swing derives from predicted
// `attackT` — both reduce to (phase, progress), so one render path draws every swing.
function swingRenderState(
	e: Entity,
): { phase: AttackPhase; progress: number } | null {
	if (e.action && e.action.move !== 'idle')
		return { phase: e.action.phase, progress: e.action.progress };
	// The local Avatar's swing is predicted from attackT against the ONE shared phase
	// machine (ADR 0024 — no per-weapon durations).
	const phase = swingPhase(e.attackT);
	return phase ? { phase, progress: swingProgress(e.attackT) } : null;
}

// Realize an entity's basic swing (ADR 0018 §5). A weaponed Avatar's swing IS the
// composited WeaponSprite (drawn via `drawEntitySprite`), so there's nothing to overlay
// and we bail. Only an unarmed entity (a Monster has no weapon sprite) falls back to a
// single-glyph tip telegraph so its attack still reads.
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
	// A single tip glyph, cocked-back → level → trailing across the phases.
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

// Whether an entity is bracing a raised Guard. Co-present entities carry the `guarding`
// bit in the replicated `flags` (ADR 0017 §10); the local Avatar derives it from predicted
// `guardT` — one render path for every brace.
function isGuarding(e: Entity): boolean {
	if (e.action) return (e.action.flags & ACTION_FLAG.guarding) !== 0;
	return guardRaised(e.guardT ?? 0);
}

// Realize an entity's raised Guard as a frontal brace glyph (ADR 0017 §5/§13a): drawn for
// the local Avatar and co-present ones through one path, so a brace reads the same to its
// owner and to an attacker deciding whether to commit.
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

	// Static scene via the shared renderer — the same path forge preview uses, so what
	// authors see is what ships (ADR 0008 / #56).
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

	// First particle pass (ADR 0013): resting/fading blood just above terrain so it reads as
	// floor splatter, behind the Sprites that follow.
	drawParticles(
		buf,
		particles,
		cam,
		zone.terrain,
		sw,
		sh,
		(p) => p.stage !== 'airborne',
	);

	// Interaction prompts depend on the local Avatar's overlap, so they're client-only
	// overlays on top of the static scene.
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
			// A signpost is READ, not talked to: its nudge floats above the board, stacked bottom-up.
			const lines = onNpc.lines;
			lines.forEach((line, i) => {
				drawText(buf, sx, sy - lines.length + i, line, C.signpost, sw, sh);
			});
		} else {
			drawText(buf, sx, sy - 1, `↵ e  talk to ${onNpc.name}`, C.vendor, sw, sh);
		}
	}

	// In-world loot Drops (#238): a rarity-coloured `◆` with a floating rarity+name label, so
	// rarity reads by colour. The server streams only this Player's own Drops, so everything
	// here is already ours (auto-picked-up on touch).
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

	// Co-present Avatars' swings from their replicated action-state (ADR 0017 §10) — what
	// makes another Player's attack visible. The local Avatar's is drawn after its Sprite, below.
	for (const e of others) {
		drawSwing(buf, e, cam, sw, sh);
		// A co-present Player's raised Guard (ADR 0017 §5), visible to everyone.
		drawGuard(buf, e, cam, sw, sh);
	}

	// Monster swings, from the same replicated action-state: the telegraphed wind-up is what
	// the Player reads to step away and punish the recovery (ADR 0017 §9).
	for (const m of zone.monsters) drawSwing(buf, m, cam, sw, sh);

	// Detected from the freshly-set cooldown, mirroring the melee flash window.
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

	// Dodge after-images (ADR 0017 §5/§13e): every live echo in one pass, drawn just under
	// the Sprites so a ghost never occludes a live body.
	drawDodgeEchoes(buf, dodgeEchoes, cam, sw, sh);

	// The local Avatar drawn last, on top of everyone (ADR 0003), onto the same terrain
	// renderZoneScene drew (ADR 0021).
	drawEntitySprite(buf, p, cam, STYLE, zone.terrain);
	// The local Avatar's own swing, predicted from `attackT` for zero-lag feel.
	drawSwing(buf, p, cam, sw, sh);
	// The local Avatar's own Guard brace, predicted from `guardT` for zero-lag feel.
	drawGuard(buf, p, cam, sw, sh);

	// Second particle pass: airborne blood in front of the Sprites, still below the over-head
	// bubbles/emotes so chat stays legible.
	drawParticles(
		buf,
		particles,
		cam,
		zone.terrain,
		sw,
		sh,
		(pt) => pt.stage === 'airborne',
	);

	// Co-present Players' Handles as a TOP layer (ADR 0023): after all combat FX so a name is
	// never occluded, but BEFORE the Speech bubbles — names under the feet, bubbles above the
	// head, so they never collide. The local Avatar is omitted (camera centred on you).
	drawNameplates(buf, others, cam, zone.terrain, STYLE);

	// Final pass: over-head Speech bubbles for every chatter, the local Avatar included
	// (ADR 0007). An absent sender has no entity here, so its bubble isn't drawn.
	for (const e of others) drawSpeechBubble(buf, e, cam, zone.terrain, sw, sh);
	drawSpeechBubble(buf, p, cam, zone.terrain, sw, sh);

	// Drawn last so nothing occludes an incoming shot.
	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		// Every shot is hostile (ADR 0024) — the warm-orange pebble.
		buf.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}
}

// Last-frame snapshot of an Avatar, kept per id to detect a dodge-start edge, recover its
// pre-hop position for the first after-image sample, and pace the sampling that follows
// (ADR 0017 §13e).
type DodgeTrack = {
	x: number;
	y: number;
	facing: Entity['facing'];
	dodging: boolean;
	sinceSampleMs: number; // time since the last after-image was captured, while dodging
};

export class PlayfieldRenderable extends Renderable {
	game: GameState | null = null;

	// The world-sound sink (ADR 0014), set by index.ts. The playfield voices the same combat
	// Effects it spawns particles for, spatialized against the live camera.
	sound: SoundSink | null = null;

	private camState: CameraState = initCameraState();
	// Camera-kick + hitstop (ADR 0017 §13c): view-only impact juice on a Poise break. The
	// kick is a decaying viewport offset on the follow camera; the hitstop holds the last frame.
	private kick: Kick = NO_KICK;
	private hitstop: Hitstop = NO_HITSTOP;
	// The client-local particle system (ADR 0013), advanced at render framerate, drawn
	// two-pass by drawPlayfield.
	private particles = new ParticleSystem();
	private lastParticleTick = -1;
	// The zone the dedup gate was last advanced in, so it resets on a zone change (#268).
	private lastZoneId: string | null = null;
	private lastTime = 0;
	// Dodge after-images (ADR 0017 §5/§13e): live echoes + per-entity bookkeeping to spot a
	// dodge-start edge. A rising edge plants an echo at the entity's PREVIOUS position (the
	// pre-hop spot). Keyed by id, rebuilt each frame so departed Avatars drop out.
	private dodgeEchoes: DodgeEcho[] = [];
	private dodgeTrack = new Map<number, DodgeTrack>();
	// Locally-predicted Effects (ADR 0013): the acting client spawns its own outgoing-hit
	// blood immediately, off the server tick, so it isn't gated by lastParticleTick.
	private predicted: Effect[] = [];

	// Spawn particles for locally-predicted Effects now, independent of the snapshot tick.
	// The server suppresses these back to us, so they never double-render.
	emitPredicted(effects: Effect[]): void {
		if (effects.length) this.predicted.push(...effects);
	}

	// Fire the level-up fountain at the local Avatar (#271): a radial gold burst — client-only
	// cosmetic, off the wire and sim, so it never touches progression.
	levelUpBurst(): void {
		if (!this.game) return;
		const a = this.game.player.avatar;
		const cx = a.x + BOX.w / 2;
		const cy = a.y + BOX.h / 2;
		for (let i = 0; i < LEVELUP_SPECKS; i++)
			this.particles.spawn(LEVELUP, cx, cy, 0, Math.random);
	}

	// Consume snapshot Effects once per sim tick (a faster render loop re-sees the same tick).
	// The gotcha: a zone change starts a new Effect stream on a tick that can collide with the
	// last one consumed in the old zone, wedging the gate; resetting it on any zone change
	// guarantees the new zone's entry burst still fires (#268).
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

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		super(ctx, { width: '100%', height: '100%', live: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (!this.game) return;
		const now = performance.now();
		const dt = this.lastTime ? now - this.lastTime : 0;
		this.lastTime = now;

		// Hitstop (ADR 0017 §13c): a render-only freeze. Hold the last drawn frame and repaint
		// nothing — the sim keeps advancing in index.ts, only the playfield redraw is gated.
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

		// Advance the particle system at render framerate. Fresh Effects are consumed once per
		// sim tick (guarded by world.tick so a faster render loop can't double-spawn a burst).
		const snapshotEffects = this.consumeSnapshotEffects(
			this.game.player.zoneId,
			this.game.world.tick,
			this.game.effects ?? [],
		);
		// Snapshot Effects fire once per server tick; predicted Effects (own swing)
		// fire immediately and are drained each frame so they spawn exactly once.
		const fresh = this.predicted.length
			? [...snapshotEffects, ...this.predicted]
			: snapshotEffects;
		this.predicted = [];

		// Impact juice on a Poise break (ADR 0017 §13c): the `impact` Effect fires a camera-kick
		// and a brief hitstop. Light chip hits emit `blood` and get none of this ("big moments only").
		for (const fx of fresh)
			if (fx.kind === 'impact') {
				this.kick = applyKick(this.kick, fx.dir * CAMERA_KICK.maxCells, -1);
				this.hitstop = triggerHitstop(this.hitstop);
			}
		// Layer the decaying kick onto the follow camera for this frame's draw.
		this.kick = stepKick(this.kick, dt);
		const cam = { x: baseCam.x + this.kick.x, y: baseCam.y + this.kick.y };

		stepParticles(this.particles, fresh, dt, zone.terrain, Math.random, {
			x: cam.x,
			y: cam.y,
			w: buffer.width,
			h: buffer.height,
		});

		// Sample Dodge after-images along each Avatar's hop (ADR 0017 §13e): while dodging capture
		// a silhouette every SAMPLE_INTERVAL_MS — the first at the pre-hop spot (last frame's
		// position, on the false→true edge), the rest at the live position. Decoupled from the
		// i-frame `dodgeT`.
		const nextTrack = new Map<number, DodgeTrack>();
		for (const e of [a, ...(this.game.others ?? [])]) {
			const dodging = isDodging(e);
			const prev = this.dodgeTrack.get(e.id);
			const started = dodging && !prev?.dodging;
			let sinceSampleMs = (prev?.sinceSampleMs ?? 0) + dt;
			if (started) {
				// First sample at the pre-hop origin (last frame's position).
				spawnDodgeEcho(this.dodgeEchoes, {
					x: prev?.x ?? e.x,
					y: prev?.y ?? e.y,
					facing: e.facing,
					type: e.type,
				});
				sinceSampleMs = 0;
			} else if (dodging && sinceSampleMs >= SAMPLE_INTERVAL_MS) {
				// Subsequent samples at the live position as the dash carries it forward.
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

		// Voice the same fresh Effects as world SoundEffects (ADR 0014), spatialized against the
		// live camera. In lockstep with their particles, so audio and pixels never diverge. A kill
		// voices death, not hit+death (the coincident blood is suppressed in effectSoundCues).
		if (this.sound && fresh.length) {
			const centerX = cam.x + buffer.width / 2;
			const cues = effectSoundCues(fresh, centerX, buffer.width / 2);
			for (const cue of cues)
				this.sound.play(cue.kind, { volume: cue.volume, pan: cue.pan });
		}

		drawPlayfield(buffer, this.game, cam, this.particles, this.dodgeEchoes);
	}
}
