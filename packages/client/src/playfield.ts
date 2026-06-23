import type { Effect, Entity, GameState, Terrain } from '@mmo/shared';
import {
	aabbOverlap,
	activeZone,
	BOX,
	buildSceneStyle,
	COMBAT,
	drawEntitySprite,
	emoteById,
	entityBox,
	isSolid,
	meleeHitbox,
	type RenderStyle,
	renderZoneScene,
	type Sprite,
	skillForSlot,
	skillHitbox,
	spriteFor,
	spriteForNpc,
} from '@mmo/shared';
import {
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type RenderContext,
	RGBA,
} from '@opentui/core';
import { layoutBubble } from './bubble';
import { type CameraState, initCameraState, stepCamera } from './camera';
import {
	type Particle,
	ParticleSystem,
	particleColor,
	particleDrawRow,
	particleGlyph,
	stepParticles,
} from './particles';
import type { SoundKind } from './sound/registry';
import { effectSoundCues } from './sound/world';
import { COLORS as C } from './theme';

// The minimal audio sink the playfield needs: just `play`. Kept as an interface so
// the render path depends on the SoundSystem's surface, not its construction, and
// stays a no-op when audio is unset/disabled.
export interface SoundSink {
	play(kind: SoundKind, opts?: { volume?: number; pan?: number }): void;
}

// The colour binding for the shared, framework-agnostic renderer (@mmo/shared):
// resolved from the shared scene colour DATA so the game and the forge
// preview render from one source and can't drift (#56).
const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// One lit interior cell of an over-head box: its glyph and colour. A `null` cell
// is blank — it becomes interior padding (a frosted `▒` shade, ADR 0016).
type BoxCell = { ch: string; fg: RGBA } | null;

// The grid an over-head box frames: its size plus a per-cell lookup. Chat text and
// emote pixel-art both reduce to this, so the box geometry serves both.
interface BoxContent {
	w: number;
	h: number;
	cell(x: number, y: number): BoxCell;
}

// Word-wrapped chat text as box content: each character in the sender's colour,
// spaces left blank (#59, ADR 0007).
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

// A Sprite as box content: its lit glyphs coloured through the renderer's palette
// (the same resolution entity Sprites use), transparent cells left blank. This is
// what makes an emote a sized-up, glyph-style pixel-art image (#38).
function spriteContent(
	sprite: Sprite,
	palette: Readonly<Record<string, RGBA>>,
	paletteDefault: RGBA,
): BoxContent {
	const rows = sprite.rows(1);
	const keys = sprite.colorKeys(1);
	return {
		w: sprite.w,
		h: sprite.h,
		cell(x, y) {
			const ch = rows[y]?.[x];
			if (!ch || ch === ' ') return null;
			return { ch, fg: palette[keys[y]?.[x]] ?? paletteDefault };
		},
	};
}

// The shared over-head box behind both the chat Speech bubble (#59, ADR 0007) and
// the emote (#38): a bordered box with a downward tail, anchored above the
// nameplate and re-projected through the camera each frame so it tracks the moving
// Avatar. x-clamped to the viewport so it can't clip off-screen. Every cell sits on
// the colour ALREADY under it — terrain (`terrainFg`) where solid ground is below,
// sky (`bg`) otherwise (ADR 0016) — because terrain is a `█` FOREGROUND block: any
// glyph the box draws replaces it, so the base must be re-supplied or the dark
// `terrainBg` shows through (the "tint spilling outside the border" bug). On that
// base: the frame + tail are the border glyph (no dark stamp); interior PADDING is a
// `▒` frosted shade that dithers the base; and TEXT is a bright glyph on a ~50% dark
// backing for legibility. The two callers differ only in their CONTENT and border
// colour — the geometry is one place so they can't drift.
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
				// Frame glyph over the sampled base: the cell matches its surroundings,
				// with just the rounded line on top — no bleed outside the border.
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
				// Interior padding: a frosted `▒` shade dithering the base, so terrain
				// peeks through the stipple.
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

// A transient emote (#38): the emote id resolved to its pixel-art Sprite, drawn in
// the SAME over-head box as a Speech bubble (one shared renderer) on the telegraph
// layer (above all Sprites, ADR 0003), self-clearing upstream. The warm emote
// border distinguishes a reaction from a chat line at a glance.
function drawEmote(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
) {
	if (!e.emote) return;
	const def = emoteById(e.emote);
	if (!def) return;
	const content = spriteContent(
		def.sprite,
		STYLE.palette,
		STYLE.paletteDefault,
	);
	drawOverheadBox(buf, e, cam, terrain, sw, sh, content, C.emote);
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

// Blit every active speck the `keep` filter selects, projected through the camera
// and alpha-blended so overlapping blood reads denser. Colour + glyph come from
// the pure particle helpers (ADR 0013), so this stays a thin blitter.
function drawParticles(
	buf: OptimizedBuffer,
	particles: ParticleSystem,
	cam: { x: number; y: number },
	terrain: Terrain,
	sw: number,
	sh: number,
	keep: (p: Particle) => boolean,
) {
	// Match the terrain layer's projection (render.ts): a world cell (col,row) draws
	// at screen (col - round(cam.x), row - round(cam.y)). Resolving the draw cell in
	// world space lets particleDrawRow check solidity against the SAME terrain the
	// player sees, so the clamp can't drift from what's rendered.
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

function drawPlayfield(
	buf: OptimizedBuffer,
	game: GameState,
	cam: { x: number; y: number },
	particles: ParticleSystem,
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

	// Static scene (terrain, portals, NPCs, z-ordered Monsters + co-present
	// Avatars + nameplates) via the shared renderer — the same path forge
	// preview uses, so what authors see is what ships (ADR 0008 / #56).
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

	// First particle pass (ADR 0013): resting / fading blood draws just above
	// terrain so it reads as splatter on the floor, behind the Sprites and the
	// local Avatar that follow.
	drawParticles(
		buf,
		particles,
		cam,
		zone.terrain,
		sw,
		sh,
		(p) => p.stage !== 'airborne',
	);

	// Interaction prompts depend on the local Avatar's overlap, so they're
	// client-only dynamic overlays drawn on top of the static scene.
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
		drawText(buf, sx, sy - 1, `↵ e  talk to ${onNpc.name}`, C.vendor, sw, sh);
	}

	if (p.attackT > COMBAT.attackCooldown - 0.12) {
		const hb = meleeHitbox(p);
		for (let yy = 0; yy < hb.h; yy++) {
			for (let xx = 0; xx < hb.w; xx++) {
				const px = Math.round(hb.x + xx - cam.x);
				const py = Math.round(hb.y + yy - cam.y);
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(
						px,
						py,
						p.facing === 1 ? '/' : '\\',
						C.melee,
						C.transparent,
					);
			}
		}
	}

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
					buf.setCellWithAlphaBlending(px, py, '✦', C.melee, C.transparent);
			}
		}
	}

	// The local Avatar is drawn last, on top of everyone (ADR 0003).
	drawEntitySprite(buf, p, cam, STYLE);

	// Second particle pass: airborne blood erupts in front of the Sprites (toward
	// the camera), still below the over-head Speech bubbles / emotes that follow so
	// chat stays legible.
	drawParticles(
		buf,
		particles,
		cam,
		zone.terrain,
		sw,
		sh,
		(pt) => pt.stage === 'airborne',
	);

	// Final pass after all Sprites + nameplates: over-head Speech bubbles for every
	// chatter on screen, the local Avatar included (one uniform rule, ADR 0007). An
	// absent sender simply has no entity here, so its bubble isn't drawn.
	for (const e of others) drawSpeechBubble(buf, e, cam, zone.terrain, sw, sh);
	drawSpeechBubble(buf, p, cam, zone.terrain, sw, sh);

	// Over-head emotes for every emoting Avatar on screen, the local one included —
	// one uniform rule (#38, ADR 0003), on top of all Sprites and nameplates.
	for (const e of others) drawEmote(buf, e, cam, zone.terrain, sw, sh);
	drawEmote(buf, p, cam, zone.terrain, sw, sh);

	// Drawn last so nothing occludes an incoming shot.
	for (const pr of zone.projectiles) {
		const px = Math.round(pr.x - cam.x);
		const py = Math.round(pr.y - cam.y);
		if (px < 0 || px >= sw || py < 0 || py >= sh) continue;
		const ch = pr.vx < 0 ? '◄' : pr.vx > 0 ? '►' : '●';
		buf.setCellWithAlphaBlending(px, py, ch, C.projectile, C.transparent);
	}
}

export class PlayfieldRenderable extends Renderable {
	game: GameState | null = null;

	// The world-sound sink (ADR 0014). Set by index.ts to the SoundSystem; the
	// playfield voices the same per-tick combat Effects it spawns particles for,
	// spatialized against the live camera. Null/disabled audio is a silent no-op.
	sound: SoundSink | null = null;

	private camState: CameraState = initCameraState();
	// The client-local particle system (ADR 0013): combat Effects off the sim feed
	// it, it's advanced at render framerate, drawn two-pass by drawPlayfield.
	private particles = new ParticleSystem();
	private lastParticleTick = -1;
	private lastTime = 0;
	// Locally-predicted Effects awaiting the next frame (ADR 0013): the acting
	// client spawns its own outgoing-hit blood immediately, off the server tick,
	// so it isn't gated by lastParticleTick. Drained every renderSelf.
	private predicted: Effect[] = [];

	// Spawn particles for locally-predicted Effects right now (the own swing's
	// blood), independent of the snapshot tick. The server suppresses these back to
	// us (originator-suppression), so they never double-render against a snapshot.
	emitPredicted(effects: Effect[]): void {
		if (effects.length) this.predicted.push(...effects);
	}

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		super(ctx, { width: '100%', height: '100%', live: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		if (!this.game) return;
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
		const cam = this.camState.cam;
		if (!cam) return;

		// Advance the particle system at render framerate. Fresh Effects are consumed
		// once per sim tick (guarded by world.tick so a faster render loop can't spawn
		// the same burst twice); off-camera bursts are skipped inside stepParticles.
		const now = performance.now();
		const dt = this.lastTime ? now - this.lastTime : 0;
		this.lastTime = now;
		const tick = this.game.world.tick;
		const snapshotEffects =
			tick !== this.lastParticleTick ? (this.game.effects ?? []) : [];
		this.lastParticleTick = tick;
		// Snapshot Effects fire once per server tick; predicted Effects (own swing)
		// fire immediately and are drained each frame so they spawn exactly once.
		const fresh = this.predicted.length
			? [...snapshotEffects, ...this.predicted]
			: snapshotEffects;
		this.predicted = [];
		stepParticles(this.particles, fresh, dt, zone.terrain, Math.random, {
			x: cam.x,
			y: cam.y,
			w: buffer.width,
			h: buffer.height,
		});

		// Voice the same fresh Effects as world SoundEffects (ADR 0014), spatialized
		// against the live camera: pan by horizontal offset, volume by distance, y
		// ignored, out-of-range dropped. Snapshot Effects fire once per tick and
		// predicted own-hits fire immediately — in lockstep with their particles, so
		// audio and pixels never diverge. A kill voices death, not hit+death (the
		// coincident lethal-blow blood is suppressed in effectSoundCues).
		if (this.sound && fresh.length) {
			const centerX = cam.x + buffer.width / 2;
			const cues = effectSoundCues(fresh, centerX, buffer.width / 2);
			for (const cue of cues)
				this.sound.play(cue.kind, { volume: cue.volume, pan: cue.pan });
		}

		drawPlayfield(buffer, this.game, cam, this.particles);
	}
}
