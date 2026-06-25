import {
	ACTION_FLAG,
	bladeEdgeArc,
	sweepIndex,
	swingPhase,
	swingProgress,
	weaponFrame,
} from './combat';
import { BOX } from './constants';
import {
	bodyFrame,
	formById,
	formFrame,
	HATS,
	mirrorAnchorX,
	type Sprite,
	spriteFor,
	spriteForNpc,
	WEAPON_ACCENT_KEY,
	type WeaponSprite,
} from './sprites';
import { isSolid } from './terrain';
import type {
	AttackPhase,
	Entity,
	Facing,
	MoveId,
	Npc,
	Terrain,
} from './types';
import { weaponById } from './weapons';
import type { Portal } from './world';

// A framework-agnostic cell sink, the subset of opentui's OptimizedBuffer the
// renderer needs. Generic over the colour type `C` so @mmo/shared stays
// opentui-free: the client and forge each bind `C` to their own RGBA.
export interface CellBuffer<C> {
	readonly width: number;
	readonly height: number;
	clear(bg: C): void;
	setCell(x: number, y: number, ch: string, fg: C, bg: C): void;
	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: C,
		bg: C,
	): void;
}

// Colours the static Zone scene needs, resolved by the caller (opentui RGBA in
// practice). `palette` maps a Sprite's single-char colour keys to colours;
// unknown keys fall back to `paletteDefault`.
export interface RenderStyle<C> {
	bg: C;
	terrainFg: C;
	terrainBg: C;
	portal: C;
	transparent: C;
	hurt: C;
	// `nameplate` is the Handle text colour (full opacity); `nameplateBg` is the same
	// hue ~30%-darkened and opaque — the per-glyph backing behind the default Handle
	// (ADR 0023). Per-cosmetic backings live in `cosmetics.nameplateBgs`.
	nameplate: C;
	nameplateBg: C;
	palette: Readonly<Record<string, C>>;
	paletteDefault: C;
	// Cosmetic catalogs resolved into the colour type (#35), indexed by an Avatar's
	// `Cosmetics` choices: `hues[hue]` recolours the body, `nameplates[nameplate]`
	// colours the Handle ink. Hat art is glyph data (HATS), so it needs no colour here.
	cosmetics: {
		hues: readonly C[];
		nameplates: readonly C[];
		nameplateBgs: readonly C[];
	};
}

// The static, simulation-free layers of a Zone: terrain, portals, NPCs, and a
// pre-z-ordered set of entities (Monsters + co-present Avatars). Interaction
// prompts, the local Avatar, telegraphs, speech bubbles and projectiles are the
// caller's dynamic overlays, drawn on top after this.
export interface ZoneScene {
	terrain: Terrain;
	portals: readonly Portal[];
	npcs: readonly Npc[];
	entities: readonly Entity[];
}

// A translucent "ghost" blit: the sprite is drawn EXACTLY as it ships — every glyph
// unchanged — but each cell's real colour is run through `fade` and laid over an
// opaque `bg`, and the sprite's transparent cells are filled with `bg` too so the
// whole footprint reads as one solid rectangle (no gappy silhouette). Fading the
// colour (not swapping the glyph) is what makes the preview read as translucent, so
// it works for every glyph uniformly — the old per-glyph swap garbled the puzzle-shape
// blocks it had no lighter character for (#118). `fade` lives on the caller because
// @mmo/shared is colour-type-agnostic (it can't blend `C` itself); the forge editor
// passes a fade that composites the colour onto the placement-state tint
// (grounded/airborne/invalid).
export interface GhostStyle<C> {
	bg: C;
	/** Maps a sprite's real cell colour to its faded ghost form (e.g. composited
	 *  onto `bg` at low opacity). Applied to every lit cell in ghost mode. */
	fade: (fg: C) => C;
}

// Blit a Sprite's lit glyphs into the buffer with palette colours, clipping to
// the viewport. A `hurt` flash overrides every glyph with the hurt colour. An
// optional `recolor` overrides specific colour keys for this blit only — the seam
// the cosmetic body hue uses to repaint the Avatar's `p` cells per Avatar (#35),
// leaving the shared palette untouched. An optional `ghost` keeps every glyph as-is
// but fades each cell's colour (via `ghost.fade`) over an opaque tint (#118).
// The per-cell terrain context a body/sprite blit needs to plant onto the ground
// (ADR 0021): the world grid plus the whole-cell camera offset, so the blit can ask
// `isSolid` under each screen cell. When a lit cell sits over solid terrain its
// background is painted with the visible block colour (`terrainFg`) and written
// OPAQUELY — never alpha-blended over the existing cell, which would composite over the
// hidden `terrainBg` and stamp a dark notch (the base-then-blend lesson from ADR 0016).
// Absent → the sprite blits transparently as before (the forge ghost, off-terrain feet).
interface PlantContext {
	terrain: Terrain;
	camX: number;
	camY: number;
}

function blitSprite<C>(
	buf: CellBuffer<C>,
	sprite: Sprite,
	sx: number,
	sy: number,
	facing: Facing,
	hurt: boolean,
	style: RenderStyle<C>,
	recolor?: Readonly<Record<string, C>>,
	ghost?: GhostStyle<C>,
	plant?: PlantContext,
): void {
	const sw = buf.width;
	const sh = buf.height;
	const glyphs = sprite.rows(facing);
	const keys = sprite.colorKeys(facing);
	for (let ry = 0; ry < sprite.h; ry++) {
		const py = sy + ry;
		if (py < 0 || py >= sh) continue;
		const row = glyphs[ry];
		const krow = keys[ry];
		for (let rx = 0; rx < sprite.w; rx++) {
			const px = sx + rx;
			if (px < 0 || px >= sw) continue;
			const ch = row[rx];
			if (ch === ' ') {
				// In ghost mode a transparent cell still paints the tint, so the whole
				// sprite footprint reads as one solid rectangle instead of a gappy
				// silhouette; in normal mode it stays see-through (skip).
				if (ghost) buf.setCell(px, py, ' ', ghost.bg, ghost.bg);
				continue;
			}
			const key = krow[rx];
			const fg = hurt
				? style.hurt
				: (recolor?.[key] ?? style.palette[key] ?? style.paletteDefault);
			if (ghost) buf.setCell(px, py, ch, ghost.fade(fg), ghost.bg);
			else if (
				plant &&
				isSolid(plant.terrain, px + plant.camX, py + plant.camY)
			)
				// Over solid ground: paint the cell's background with the visible terrain
				// block colour and write OPAQUELY, so a half-block foot's air-side reads as
				// ground (the boot's top half stays the body colour). Opaque, not blended,
				// so it never composites over the hidden terrainBg (ADR 0021 / ADR 0016).
				buf.setCell(px, py, ch, fg, style.terrainFg);
			else buf.setCellWithAlphaBlending(px, py, ch, fg, style.transparent);
		}
	}
}

// The screen baseline an Entity's sprite plants by (ADR 0021): a per-Form property
// for an Avatar BodySprite, else the legacy single-frame Sprite's own `baseline`.
// Shared by the sprite blit (which shifts the body DOWN by it) and the nameplate pass
// (which anchors one row BELOW the planted feet), so the two never disagree (ADR 0023).
function baselineFor(e: Entity): number {
	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	return body ? (body.baseline ?? 0) : spriteFor(e.type).baseline;
}

// The hat Sprite an Avatar wears this frame, or null (bareheaded, a Monster, or a
// stray index). Centralised so the Sprite blit and the nameplate offset agree on
// the same hat height (#35).
function hatFor(e: Entity): Sprite | null {
	return e.cosmetics ? (HATS[e.cosmetics.hat]?.sprite ?? null) : null;
}

// The WeaponSprite an Entity wields this frame, or null (unarmed Monster, or a
// weapon with no authored art yet). Rides the replicated `Entity.weapon` index, so
// observers resolve the same held weapon the owner does (ADR 0018 §1).
function weaponSpriteFor(e: Entity): WeaponSprite | null {
	if (e.weapon === undefined) return null;
	return weaponById(e.weapon).sprite ?? null;
}

// The per-Avatar body recolour for its chosen hue, or undefined (no cosmetics /
// stray index). Repaints the Sprite's `p` body cells; a stray hue index falls back
// to the unrecoloured palette (#35).
function recolorFor<C>(
	e: Entity,
	style: RenderStyle<C>,
): Readonly<Record<string, C>> | undefined {
	const hue = e.cosmetics && style.cosmetics.hues[e.cosmetics.hue];
	return hue !== undefined ? { p: hue } : undefined;
}

// An Entity Sprite, centred horizontally over the ~1×2 collision box with its
// feet aligned to the box bottom (ADR 0003). Entities round relative to the
// FLOAT `cam` (not the whole-cell terrain camera) so a camera-pinned Avatar sits
// on a stable cell instead of bouncing ±1 from double-rounding. An Avatar's
// cosmetic hue recolours the body and its cosmetic hat is overlaid on the head (#35).
export function drawEntitySprite<C>(
	buf: CellBuffer<C>,
	e: Entity,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
	terrain?: Terrain,
	ghost?: GhostStyle<C>,
): void {
	// The action an entity is performing this frame (ADR 0017 §10): observers read the
	// replicated action-state; the local Avatar predicts its swing from `attackT`. Drives
	// BOTH the body Pose and the weapon frame, so the two layers always agree.
	let move: MoveId;
	let phase: AttackPhase | null;
	let progress: number;
	let staggered: boolean;
	// The active body emote (ADR 0020 §9): an observer reads it from the replicated
	// action-state; the local Avatar (no `action`) reads its predicted entity fields. Fed
	// into the same `bodyFrame` ladder below, so the wave poses on owner and observer alike.
	let emote: string | null;
	let emoteT: number;
	if (e.action) {
		move = e.action.move;
		phase = e.action.phase;
		progress = e.action.progress;
		staggered = (e.action.flags & ACTION_FLAG.staggered) !== 0;
		emote = e.action.emote;
		emoteT = e.action.emoteT;
	} else {
		const swing = weaponById(e.weapon).swing;
		phase = swingPhase(e.attackT, swing);
		move = phase ? 'basic' : 'idle';
		progress = phase ? swingProgress(e.attackT, swing) : 0;
		staggered = (e.stunT ?? 0) > 0;
		emote = e.emoteId ?? null;
		emoteT = e.emoteT ?? 0;
	}

	// The body: an Avatar poses its Form through the shared `bodyFrame` selector and
	// resolves the grid via `formFrame` (ADR 0020), so its body is animated state — not a
	// hardcoded grid — and owner/observer agree frame-for-frame. A Monster keeps its
	// single-frame Sprite until it adopts a BodySprite. This slice authors only `idle`, so
	// every Pose resolves to idle; the per-Form grip/head anchors carry the weapon and hat.
	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	let sprite: Sprite;
	let baseline: number;
	let grip: { x: number; y: number } | undefined;
	let head: { x: number; y: number } | undefined;
	if (body) {
		// The walk cycle is driven entirely by replicated kinematics (ADR 0020 §7), so the
		// owner and every observer compute the identical foot frame with no new wire field:
		// `moving` gates the gait on input-driven horizontal velocity (exactly 0 at a
		// standstill, ±speed striding, 0 into a wall), and `distanceX` is the Avatar's own
		// world x — the selector flips `walkA↔walkB` every STRIDE cells of |x|, so cadence
		// tracks speed for free. An active emote (resolved above) poses below walk, so it
		// shows only while standing still (ADR 0020 §6).
		const pose = bodyFrame({
			move,
			phase,
			swingProgress: progress,
			emote,
			emoteT,
			airborne: !e.onGround,
			moving: e.vx !== 0,
			distanceX: e.x,
			staggered,
		});
		sprite = formFrame(body, pose.poseId, pose.frameIndex);
		// The baseline is a per-Form property (applies across the whole frame set), not a
		// per-frame one, so it rides the BodySprite — not the resolved Pose grid (ADR 0021).
		baseline = body.baseline ?? 0;
		grip = body.grip;
		head = body.head;
	} else {
		sprite = spriteFor(e.type);
		// The legacy single-frame Monster path reads its baseline off the Sprite itself.
		baseline = sprite.baseline;
		grip = sprite.grip;
	}

	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	// `baseline` shifts the WHOLE sprite down so its bottom row plants on the terrain
	// surface row (`e.y + BOX.h`) instead of one cell above (ADR 0021); default 0 leaves
	// the anchor exactly where it was.
	const sy = Math.round(e.y + BOX.h - sprite.h + baseline - cam.y);
	const hurt = e.hurtT > 0.3;
	// The body/sprite layer plants onto solid ground (ADR 0021): pass the terrain context
	// so each cell over solid terrain is composited opaquely against `terrainFg`. Skipped
	// in ghost mode (the forge preview owns its own background). The whole-cell camera
	// matches the terrain layer's, so solidity lines up with the drawn blocks.
	const plant: PlantContext | undefined =
		terrain && !ghost
			? { terrain, camX: Math.round(cam.x), camY: Math.round(cam.y) }
			: undefined;
	blitSprite(
		buf,
		sprite,
		sx,
		sy,
		e.facing,
		hurt,
		style,
		recolorFor(e, style),
		ghost,
		plant,
	);

	// The equipped weapon: an always-anchored layer composited ON TOP of the body at
	// the body's grip cell, mirrored with facing (ADR 0018 §1/§3). The frame is the
	// pure shared selector's choice — `idle` at rest, else the swing phase's pose;
	// the `active` phase plays an ordered sweep sampled by swingProgress. One code
	// path: "attacking" only changes which frame is selected (ADR 0018 §1/§4).
	const ws = weaponSpriteFor(e);
	if (ws && grip) {
		const id = weaponFrame(move, phase);
		// `active` is an ordered sweep indexed by progress; the other ids are single poses.
		const frame =
			id === 'active'
				? ws.frames.active?.[sweepIndex(progress, ws.frames.active.length)]
				: ws.frames[id];
		// Body grip cell, its column reflected across the body when facing left.
		const bodyGripX = sx + mirrorAnchorX(grip.x, sprite.w, e.facing);
		const bodyGripY = sy + grip.y;
		// The one dynamic accent colour (ADR 0018 §6): the weapon's `accent` palette key
		// resolved to a colour, fed to the blade highlight AND the blade-edge arc — so the
		// weapon reads in one colour and re-tints wholesale when rarity feeds this channel.
		const accent = style.palette[ws.accent] ?? style.paletteDefault;
		if (frame) {
			// Weapon grip cell, mirrored alongside the art so grip lands on grip.
			const wgx = e.facing === 1 ? ws.grip.x : frame.w - 1 - ws.grip.x;
			blitSprite(
				buf,
				frame,
				bodyGripX - wgx,
				bodyGripY - ws.grip.y,
				e.facing,
				hurt,
				style,
				// Repaint the blade's accent cells to the dynamic accent colour for this blit.
				{ [WEAPON_ACCENT_KEY]: accent },
				ghost,
				plant,
			);
		}
		// The blade-edge arc (ADR 0018 §5): a short fading smear of curve glyphs tracing the
		// blade tip through the active strike, in the accent colour — NOT a hitbox fill.
		// Drawn ON TOP of the blade so the eye reads the swing's speed and direction; other
		// phases draw no arc, and ghost previews (forge) omit it (it's a live-motion layer).
		if (phase === 'active' && !ghost) {
			for (const c of bladeEdgeArc(progress, e.facing)) {
				const ax = bodyGripX + c.dx;
				const ay = bodyGripY + c.dy;
				if (ax < 0 || ax >= buf.width || ay < 0 || ay >= buf.height) continue;
				buf.setCellWithAlphaBlending(
					ax,
					ay,
					c.glyph,
					accent,
					style.transparent,
				);
			}
		}
	}

	// The cosmetic hat rides the body's head anchor (ADR 0018 §3 / ADR 0020 §4): centred
	// over the head cell and sitting just above it, the column mirrored with facing — the
	// same data-driven anchor as the weapon's grip, so a hat composites onto ANY Form. A
	// body with no declared head anchor falls back to centring over the Sprite.
	const hat = hatFor(e);
	if (hat) {
		const headX = head
			? mirrorAnchorX(head.x, sprite.w, e.facing)
			: (sprite.w - 1) / 2;
		const hx = sx + Math.round(headX - (hat.w - 1) / 2);
		const hy = sy + (head?.y ?? 0) - hat.h;
		blitSprite(
			buf,
			hat,
			hx,
			hy,
			e.facing,
			hurt,
			style,
			undefined,
			ghost,
			plant,
		);
	}
}

// A static NPC Sprite, centred over its box with feet on the box bottom. Drawn by
// `renderZoneScene` and reused by the forge editor's placement ghost (`ghost`) so
// the preview matches the shipped NPC exactly (#118).
export function drawNpcSprite<C>(
	buf: CellBuffer<C>,
	n: Npc,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
	ghost?: GhostStyle<C>,
): void {
	const sprite = spriteForNpc(n.kind);
	const sx = Math.round(n.x + Math.floor((n.w - sprite.w) / 2) - cam.x);
	const sy = Math.round(n.y + n.h - sprite.h - cam.y);
	blitSprite(buf, sprite, sx, sy, 1, false, style, undefined, ghost);
}

// Player Handles, drawn as a TOP layer — a single row of bare Handle text on a
// tight per-glyph backing, just BELOW each entity's planted feet (ADR 0023). This
// supersedes ADR 0016's 2-row translucent pill: no bevelled corners, no side padding,
// no bottom lip, no per-cell terrain-sampled wash.
//
// Each letter cell is OPAQUE and content-agnostic: the bright cosmetic `nameplate`
// ink on a ~30%-darkened same-hue `nameplateBg` backing. The backing is UNCONDITIONAL
// — it never samples what's behind — because as a top layer a name can land over
// bright terrain, a bright co-present sprite, or open sky, and only a content-agnostic
// backing stays legible over all three. (The backing is prebuilt in `buildSceneStyle`
// because @mmo/shared is generic over the colour type `C` and can't darken at draw
// time.) The label anchors one row below the planted feet — `e.y + BOX.h + baseline`,
// reading the SAME baseline the sprite plants by — so it tracks the lowered sprite and
// is unaffected by hat height. Only entities carrying a `name` (co-present Players) get
// one; the local Avatar is deliberately not passed (no self-nameplate).
//
// Z-order is the CALLER's: `renderZoneScene` no longer draws names, so each caller runs
// this pass at the layer it wants (the live client after the Avatar + combat FX and
// just before Speech bubbles; the forge preview right after `renderZoneScene`). The
// `terrain` argument is part of the shared pass's signature for symmetry with the other
// scene passes, even though the unconditional backing does not consult it.
export function drawNameplates<C>(
	buf: CellBuffer<C>,
	entities: readonly Entity[],
	cam: { x: number; y: number },
	terrain: Terrain,
	style: RenderStyle<C>,
): void {
	void terrain;
	for (const e of entities) {
		if (!e.name) continue;
		const idx = e.cosmetics?.nameplate;
		const ink =
			(idx !== undefined ? style.cosmetics.nameplates[idx] : undefined) ??
			style.nameplate;
		const bg =
			(idx !== undefined ? style.cosmetics.nameplateBgs[idx] : undefined) ??
			style.nameplateBg;
		// Centred over the collision box, one row below the planted feet: the sprite's
		// bottom row lands on `e.y + BOX.h - 1 + baseline`, so the name sits one past it.
		const cx = e.x + BOX.w / 2 - cam.x;
		const left = Math.round(cx - e.name.length / 2);
		const py = Math.round(e.y + BOX.h + baselineFor(e) - cam.y);
		if (py < 0 || py >= buf.height) continue;
		for (let i = 0; i < e.name.length; i++) {
			const px = left + i;
			if (px < 0 || px >= buf.width) continue;
			buf.setCell(px, py, e.name[i], ink, bg);
		}
	}
}

export function renderZoneScene<C>(
	buf: CellBuffer<C>,
	scene: ZoneScene,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
): void {
	const sw = buf.width;
	const sh = buf.height;
	const { terrain } = scene;
	const ww = terrain.w;
	const wh = terrain.h;

	// Terrain samples the integer grid, so it scrolls on a whole-cell camera;
	// entities round relative to the float `cam` instead (see camera.ts), so a
	// camera-pinned Avatar renders at a stable cell rather than bouncing ±1.
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);

	buf.clear(style.bg);

	for (let sy = 0; sy < sh; sy++) {
		const wy = sy + camY;
		for (let sx = 0; sx < sw; sx++) {
			const wx = sx + camX;
			if (
				isSolid(terrain, wx, wy) &&
				wx >= 0 &&
				wx < ww &&
				wy >= 0 &&
				wy < wh
			) {
				// A top-surface solid cell (air directly above) renders as the lower-half
				// block `▄`, dropping the visible ground line to the cell's vertical middle;
				// interior cells stay full `█` (ADR 0021). This is the other half of planting:
				// a slim top-ink `▀` foot composited into the surface cell now rests ON the
				// lowered line (boot in the top half, ground in the bottom) instead of being
				// buried by a full-height block. Non-`▀`-footed sprites float a half-cell over
				// the lowered line until they adopt contact feet — the accepted transitional
				// state of the one-sprite-at-a-time convergence.
				// The surface cell's empty TOP half is sky, so its background must be the scene
				// `bg`, NOT `terrainBg` (the dark shade that hides behind a full `█`) — else
				// every exposed ground edge stamps a faint mismatched band above it. Interior
				// `█` cells fully cover their bg, so they keep `terrainBg`.
				const surface = !isSolid(terrain, wx, wy - 1);
				if (surface) buf.setCell(sx, sy, '▄', style.terrainFg, style.bg);
				else buf.setCell(sx, sy, '█', style.terrainFg, style.terrainBg);
			}
		}
	}

	// Drawn before the Sprites so an Avatar stands in front of the door.
	for (const pr of scene.portals) {
		for (let yy = 0; yy < pr.h; yy++) {
			for (let xx = 0; xx < pr.w; xx++) {
				const px = pr.x + xx - camX;
				const py = pr.y + yy - camY;
				if (px >= 0 && px < sw && py >= 0 && py < sh)
					buf.setCellWithAlphaBlending(
						px,
						py,
						'▒',
						style.portal,
						style.transparent,
					);
			}
		}
	}

	// NPCs are static content (not simulated), keyed off their own `kind`. Drawn
	// before the entity Sprites so the player stands in front.
	for (const n of scene.npcs) drawNpcSprite(buf, n, cam, style);

	// Co-present Avatars and Monsters share one z-ordered set (by y-position) so
	// they occlude each other naturally (ADR 0003). Sorted here so every caller
	// gets correct depth without duplicating the rule. Sprites only — nameplates are
	// a caller-composited top layer now (`drawNameplates`, ADR 0023), so this pass no
	// longer draws them.
	const sprites = [...scene.entities].sort((a, b) => a.y - b.y);
	for (const e of sprites) drawEntitySprite(buf, e, cam, style, terrain);
}
