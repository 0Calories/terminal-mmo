import type {
	AttackPhase,
	Effect,
	Entity,
	GameState,
	GuardPhase,
	Terrain,
} from '@mmo/shared';
import {
	ACTION_FLAG,
	aabbOverlap,
	activeZone,
	BOX,
	buildSceneStyle,
	drawEntitySprite,
	emoteById,
	entityBox,
	guardPhase,
	guardPoseCell,
	guardPoseGlyph,
	isSolid,
	meleeHitbox,
	type RenderStyle,
	renderZoneScene,
	type Sprite,
	skillForSlot,
	skillHitbox,
	spriteFor,
	spriteForNpc,
	swingPhase,
	swingPose,
	swingPoseCell,
	swingProgress,
	weaponById,
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
	type Hitstop,
	isFrozen,
	NO_HITSTOP,
	stepHitstop,
	triggerHitstop,
} from './hitstop';
import {
	type Particle,
	ParticleSystem,
	particleColor,
	particleDrawRow,
	particleGlyph,
	stepParticles,
	WEAPON_TRAILS,
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

// The swing an entity is rendering this frame, or null. Co-present entities carry
// the authoritative `action` from the snapshot (ADR 0017 §10); the local Avatar has
// no action set, so its swing is derived from the predicted `attackT` — both reduce
// to the same (phase, progress), so one render path draws every swing.
function swingRenderState(
	e: Entity,
): { phase: AttackPhase; progress: number } | null {
	if (e.action && e.action.move !== 'idle')
		return { phase: e.action.phase, progress: e.action.progress };
	// The local Avatar's swing is predicted from attackT and read against its WEAPON's
	// phase durations (ADR 0017 §14), so a slow greatsword's phases read as slow.
	const swing = weaponById(e.weapon).swing;
	const phase = swingPhase(e.attackT, swing);
	return phase ? { phase, progress: swingProgress(e.attackT, swing) } : null;
}

// Realize an entity's basic swing from its action-state (ADR 0017 §13a/b): a
// per-phase weapon-tip pose accent every phase, plus a directional slash-arc swept
// across the live melee hitbox during the `active` phase only. Drawn for the local
// Avatar (predicted) and every co-present one (replicated) through one path, so a
// swing looks identical to its owner and to everyone watching.
function drawSwing(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	const st = swingRenderState(e);
	if (!st) return;
	// Composite the equipped WEAPON onto the per-phase pose (ADR 0017 §13b/§14): the
	// weapon's own glyph as the tip accent, swept by the shared pose system, plus its
	// reach for the slash-arc. The selection is the shared pure swingPose, so the
	// weapon looks identical to its owner and to every observer.
	const weapon = weaponById(e.weapon);
	const move = e.action && e.action.move !== 'idle' ? e.action.move : 'basic';
	const pose = swingPose(move, st.phase, weapon, e.facing);
	if (!pose) return;

	// Pose accent: the weapon tip, cocked-back → level → trailing across the phases.
	const cell = swingPoseCell(e, st.phase);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(ax, ay, pose.glyph, C.melee, C.transparent);

	// Slash-arc only while the hitbox is live (active phase): a vivid sweep of the
	// facing diagonal across the whole WEAPON reach, so the dangerous window reads at
	// a glance and matches exactly where damage lands (a greatsword's arc is wider).
	if (!pose.arc) return;
	const hb = meleeHitbox(e, weapon.reach);
	for (let yy = 0; yy < hb.h; yy++) {
		for (let xx = 0; xx < hb.w; xx++) {
			const px = Math.round(hb.x + xx - cam.x);
			const py = Math.round(hb.y + yy - cam.y);
			if (px >= 0 && px < sw && py >= 0 && py < sh)
				buf.setCellWithAlphaBlending(px, py, pose.arc, C.melee, C.transparent);
		}
	}
}

// The Guard phase an entity is bracing in this frame, or null. Co-present entities
// carry it in the replicated action `flags` (ADR 0017 §10: `guarding` + `parrying`
// bits); the local Avatar has no action set, so its Guard is derived from the predicted
// `guardT` — both reduce to the same GuardPhase, one render path for every brace.
function guardRenderState(e: Entity): GuardPhase | null {
	if (e.action) {
		if (!(e.action.flags & ACTION_FLAG.guarding)) return null;
		return e.action.flags & ACTION_FLAG.parrying ? 'parry' : 'block';
	}
	return guardPhase(e.guardT ?? 0);
}

// Realize an entity's raised Guard as a frontal brace glyph (ADR 0017 §5/§13a): a solid
// bar while Blocking, a brighter sigil through the Parry window, held just past the
// leading edge. Drawn for the local Avatar (predicted from `guardT`) and every co-present
// one (replicated via `flags`) through one path, so a brace looks the same to its owner
// and to everyone watching — a read for an attacker deciding whether to commit.
function drawGuard(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	const phase = guardRenderState(e);
	if (!phase) return;
	const cell = guardPoseCell(e);
	const ax = Math.round(cell.x - cam.x);
	const ay = Math.round(cell.y - cam.y);
	if (ax >= 0 && ax < sw && ay >= 0 && ay < sh)
		buf.setCellWithAlphaBlending(
			ax,
			ay,
			guardPoseGlyph(phase),
			phase === 'parry' ? C.parry : C.guard,
			C.transparent,
		);
}

// Spawn a weapon's active-sweep trail (ADR 0017 §14): for every Avatar mid-swing in
// its active phase whose equipped Weapon defines a trail, drop a wisp at the swept
// arc tip, biased along facing. Driven straight off the render frame (not a wire
// Effect), so the streak follows the live blade; the short-lived, non-colliding
// profiles wink out fast. Both the local Avatar and co-present ones go through one
// path, so everyone sees everyone's trail.
function emitWeaponTrails(
	particles: ParticleSystem,
	game: GameState,
	rng: () => number,
) {
	const swingers = [game.player.avatar, ...(game.others ?? [])];
	for (const e of swingers) {
		if (e.type !== 'player') continue;
		const trail = weaponById(e.weapon).trail;
		if (!trail) continue;
		const st = swingRenderState(e);
		if (st?.phase !== 'active') continue;
		const cell = swingPoseCell(e, 'active');
		particles.spawn(WEAPON_TRAILS[trail], cell.x, cell.y, e.facing, rng);
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

	// Co-present Avatars' swings, drawn from their replicated action-state (ADR 0017
	// §10) on top of the static scene — this is what makes another Player's attack
	// visible. The local Avatar's swing is drawn after its Sprite, below.
	for (const e of others) {
		drawSwing(buf, e, cam, sw, sh);
		// A co-present Player's raised Guard (ADR 0017 §5), so a brace / parry is visible
		// to everyone — another Player turtling or timing a parry reads at a glance.
		drawGuard(buf, e, cam, sw, sh);
	}

	// Monster swings, from the same replicated action-state: a melee committer's
	// telegraphed wind-up + active slash is exactly what the Player reads to step
	// away and punish the recovery (ADR 0017 §9).
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
					buf.setCellWithAlphaBlending(px, py, '✦', C.melee, C.transparent);
			}
		}
	}

	// The local Avatar is drawn last, on top of everyone (ADR 0003).
	drawEntitySprite(buf, p, cam, STYLE);
	// The local Avatar's own swing, realized from the same path as everyone else's —
	// here predicted from `attackT` (its action-state is left unset) for zero-lag feel.
	drawSwing(buf, p, cam, sw, sh);
	// The local Avatar's own Guard brace, predicted from `guardT` for zero-lag feel.
	drawGuard(buf, p, cam, sw, sh);

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
	// Camera-kick + hitstop (ADR 0017 §13c): view-only impact juice fired on a Poise
	// break (the `impact` Effect). The kick is a small decaying viewport offset layered
	// on the follow camera; the hitstop briefly holds the last drawn frame.
	private kick: Kick = NO_KICK;
	private hitstop: Hitstop = NO_HITSTOP;
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
		const now = performance.now();
		const dt = this.lastTime ? now - this.lastTime : 0;
		this.lastTime = now;

		// Hitstop (ADR 0017 §13c): a render-only freeze. While it drains, hold the last
		// drawn frame and repaint nothing — the sim keeps advancing in index.ts's frame
		// callback, only the playfield's redraw is gated. Decayed by real wall time.
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

		// Advance the particle system at render framerate. Fresh Effects are consumed
		// once per sim tick (guarded by world.tick so a faster render loop can't spawn
		// the same burst twice); off-camera bursts are skipped inside stepParticles.
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

		// Impact juice on a Poise break (ADR 0017 §13c): the `impact` Effect — emitted
		// only on a break — fires a camera-kick (a ≤2-cell pop toward the hit, decaying
		// to zero in <150ms) and a brief hitstop. Light chip hits emit `blood` and get
		// none of this, exactly as the ADR wants ("big moments only").
		// A successful Parry (ADR 0017 §5) is a "big moment" too: the `parry` clash gets
		// the same camera-kick + hitstop, so a clean catch feels as meaty as a break and
		// is felt by the parrier (the source-less Effect reaches them).
		// A Launch (ADR 0017 §6) is a "big moment" too — the juggle opening. Its Effect
		// carries dir 0 (the throw is straight up), so the kick pops UPWARD (no horizontal
		// bias) to sell the lift, plus the same brief hitstop.
		for (const fx of fresh)
			if (fx.kind === 'impact' || fx.kind === 'parry') {
				this.kick = applyKick(this.kick, fx.dir * CAMERA_KICK.maxCells, -1);
				this.hitstop = triggerHitstop(this.hitstop);
			} else if (fx.kind === 'launch') {
				this.kick = applyKick(this.kick, 0, -CAMERA_KICK.maxCells);
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

		// Weapon swing trails (ADR 0017 §14): spawned per render frame off any live
		// active-phase swing, so the streak follows the blade. Stepped next frame with
		// the rest of the pool.
		emitWeaponTrails(this.particles, this.game, Math.random);

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
