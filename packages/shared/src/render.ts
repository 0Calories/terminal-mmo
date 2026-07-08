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

// A framework-agnostic cell sink. Generic over the colour type `C` so @mmo/shared stays
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
	// `nameplate` is the Handle text colour; `nameplateBg` the same hue ~30%-darkened and
	// opaque, the per-glyph backing behind the default Handle (ADR 0023).
	nameplate: C;
	nameplateBg: C;
	palette: Readonly<Record<string, C>>;
	paletteDefault: C;
	// Cosmetic catalogs resolved into the colour type, indexed by `Cosmetics` choices.
	// Hat art is glyph data (HATS), so it needs no colour here (#35).
	cosmetics: {
		hues: readonly C[];
		nameplates: readonly C[];
		nameplateBgs: readonly C[];
	};
}

// The static, simulation-free layers of a Zone. Interaction prompts, the local Avatar,
// telegraphs, speech bubbles and projectiles are the caller's dynamic overlays, drawn
// on top after this.
export interface ZoneScene {
	terrain: Terrain;
	portals: readonly Portal[];
	npcs: readonly Npc[];
	entities: readonly Entity[];
}

// A translucent "ghost" blit: every glyph unchanged, but each cell's colour is run
// through `fade` over an opaque `bg`, and transparent cells are filled with `bg` too so
// the footprint reads as one solid rectangle. Fading the colour (not swapping the glyph)
// makes it read translucent for every glyph uniformly (#118). `fade` lives on the caller
// because @mmo/shared can't blend `C` itself.
export interface GhostStyle<C> {
	bg: C;
	/** Maps a lit cell's colour to its faded ghost form (composited onto `bg`). */
	fade: (fg: C) => C;
}

// Blit a Sprite's lit glyphs into the buffer, clipping to the viewport. `hurt` overrides
// every glyph with the hurt colour. `recolor` overrides specific colour keys for this
// blit only — the seam the cosmetic body hue repaints the Avatar's `p` cells with,
// leaving the shared palette untouched (#35). `ghost` keeps every glyph but fades its
// colour (#118).
// PlantContext is the per-cell terrain context a blit needs to plant onto the ground: a
// lit cell over solid terrain paints its background with `terrainFg` OPAQUELY — never
// alpha-blended, which would composite over the hidden `terrainBg` and stamp a dark notch
// (ADR 0021 / ADR 0016). Absent → the sprite blits transparently (the forge ghost).
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
				// In ghost mode a transparent cell still paints the tint so the footprint
				// reads as one solid rectangle; in normal mode it stays see-through.
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
				// Over solid ground: paint the background with `terrainFg` OPAQUELY, so a
				// half-block foot's air-side reads as ground. Opaque, not blended, so it never
				// composites over the hidden terrainBg (ADR 0021 / ADR 0016).
				buf.setCell(px, py, ch, fg, style.terrainFg);
			else buf.setCellWithAlphaBlending(px, py, ch, fg, style.transparent);
		}
	}
}

// The screen baseline an Entity's sprite plants by: a per-Form property for an Avatar,
// else the Sprite's own `baseline`. Shared by the sprite blit and the nameplate pass so
// the two never disagree (ADR 0021 / ADR 0023).
function baselineFor(e: Entity): number {
	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	return body ? (body.baseline ?? 0) : spriteFor(e.type).baseline;
}

// The hat Sprite an Avatar wears this frame, or null. Centralised so the Sprite blit and
// the nameplate offset agree on the same hat height (#35).
function hatFor(e: Entity): Sprite | null {
	return e.cosmetics ? (HATS[e.cosmetics.hat]?.sprite ?? null) : null;
}

// The WeaponSprite an Entity wields this frame, or null. Rides the replicated
// `Entity.weapon` index, so observers resolve the same weapon the owner does (ADR 0018 §1).
function weaponSpriteFor(e: Entity): WeaponSprite | null {
	if (e.weapon === undefined) return null;
	return weaponById(e.weapon).sprite ?? null;
}

// The per-Avatar body recolour for its chosen hue, or undefined. Repaints the Sprite's
// `p` body cells; a stray index falls back to the unrecoloured palette (#35).
function recolorFor<C>(
	e: Entity,
	style: RenderStyle<C>,
): Readonly<Record<string, C>> | undefined {
	const hue = e.cosmetics && style.cosmetics.hues[e.cosmetics.hue];
	return hue !== undefined ? { p: hue } : undefined;
}

// An Entity Sprite, centred over the collision box with feet on the box bottom (ADR 0003).
// Rounds relative to the FLOAT `cam` (not the whole-cell terrain camera) so a camera-pinned
// Avatar sits on a stable cell instead of bouncing ±1 from double-rounding.
export function drawEntitySprite<C>(
	buf: CellBuffer<C>,
	e: Entity,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
	terrain?: Terrain,
	ghost?: GhostStyle<C>,
): void {
	// Observers read the replicated action-state; the local Avatar predicts its swing from
	// `attackT`. Drives BOTH the body Pose and the weapon frame, so they always agree (ADR 0017 §10).
	let move: MoveId;
	let phase: AttackPhase | null;
	let progress: number;
	let staggered: boolean;
	// An observer reads the emote from the action-state; the local Avatar (no `action`) from
	// its predicted fields. Both feed the same `bodyFrame` ladder, so it poses alike (ADR 0020 §9).
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
		phase = swingPhase(e.attackT);
		move = phase ? 'basic' : 'idle';
		progress = phase ? swingProgress(e.attackT) : 0;
		staggered = (e.stunT ?? 0) > 0;
		emote = e.emoteId ?? null;
		emoteT = e.emoteT ?? 0;
	}

	// An Avatar poses its Form through the shared `bodyFrame`/`formFrame` selectors, so
	// owner and observer agree frame-for-frame; a Monster keeps its single-frame Sprite
	// until it adopts a BodySprite (ADR 0020).
	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	let sprite: Sprite;
	let baseline: number;
	let grip: { x: number; y: number } | undefined;
	let head: { x: number; y: number } | undefined;
	if (body) {
		// The walk cycle is driven entirely by replicated kinematics, so owner and observer
		// compute the identical foot frame with no new wire field: `moving` gates the gait on
		// horizontal velocity, and the selector flips `walkA↔walkB` every STRIDE cells of |x|,
		// so cadence tracks speed for free. An emote poses below walk (ADR 0020 §6/§7).
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
		// A per-Form property (across the whole frame set), not per-frame, so it rides the
		// BodySprite — not the resolved Pose grid (ADR 0021).
		baseline = body.baseline ?? 0;
		grip = body.grip;
		head = body.head;
	} else {
		sprite = spriteFor(e.type);
		baseline = sprite.baseline;
		grip = sprite.grip;
	}

	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	// `baseline` shifts the WHOLE sprite down so its bottom row plants on the terrain
	// surface row instead of one cell above; default 0 leaves the anchor put (ADR 0021).
	const sy = Math.round(e.y + BOX.h - sprite.h + baseline - cam.y);
	const hurt = e.hurtT > 0.3;
	// Pass the terrain context so each cell over solid ground composites opaquely against
	// `terrainFg`. Skipped in ghost mode (the forge preview owns its background); the
	// whole-cell camera matches the terrain layer's, so solidity lines up (ADR 0021).
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

	// The equipped weapon: a layer composited ON TOP of the body at its grip cell, mirrored
	// with facing. The frame is the shared selector's choice — `idle` at rest, else the swing
	// phase's pose; "attacking" only changes which frame is selected (ADR 0018 §1/§3/§4).
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
		// The weapon's `accent` palette key resolved to a colour, fed to the blade highlight
		// AND the blade-edge arc, so the weapon re-tints wholesale in one channel (ADR 0018 §6).
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
		// A fading smear tracing the blade tip through the active strike, NOT a hitbox fill.
		// Drawn ON TOP of the blade; other phases draw no arc, and ghost previews omit it
		// (a live-motion layer) (ADR 0018 §5).
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

	// The cosmetic hat rides the body's head anchor, centred over the head cell and just
	// above it, mirrored with facing — the same data-driven anchor as the weapon's grip, so
	// it composites onto ANY Form. No head anchor → centred over the Sprite (ADR 0018 §3 / ADR 0020 §4).
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

// A static NPC Sprite, centred over its box with feet on the box bottom. Reused by the
// forge editor's placement ghost so the preview matches the shipped NPC (#118).
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

// Player Handles as a TOP layer — a row of Handle text on a per-glyph backing, just
// BELOW each entity's planted feet (ADR 0023). The backing is UNCONDITIONAL (never
// samples what's behind) because a top-layer name can land over bright terrain, a
// sprite, or sky, and only a content-agnostic backing stays legible over all three;
// it's prebuilt in `buildSceneStyle` because @mmo/shared can't darken `C` at draw time.
// Only entities with a `name` (co-present Players) get one — the local Avatar is not
// passed (no self-nameplate). Z-order is the CALLER's; `renderZoneScene` no longer draws
// names. The `terrain` arg is unused here, kept for signature symmetry with the other passes.
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

	// Terrain samples the integer grid, so it scrolls on a whole-cell camera; entities
	// round relative to the float `cam` instead, so a camera-pinned Avatar renders at a
	// stable cell rather than bouncing ±1.
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
				// A top-surface solid cell (air above) renders as the lower-half block `▄`,
				// dropping the ground line to the cell's middle so a `▀` foot rests ON it;
				// interior cells stay full `█` (ADR 0021). The surface cell's empty TOP half is
				// sky, so its background is the scene `bg`, NOT `terrainBg` (which would stamp a
				// faint mismatched band above every exposed edge); interior `█` cells keep `terrainBg`.
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

	// Drawn before the entity Sprites so the player stands in front.
	for (const n of scene.npcs) drawNpcSprite(buf, n, cam, style);

	// Avatars and Monsters share one y-sorted set so they occlude each other naturally,
	// sorted here so every caller gets correct depth (ADR 0003). Sprites only — nameplates
	// are a caller-composited top layer now (`drawNameplates`, ADR 0023).
	const sprites = [...scene.entities].sort((a, b) => a.y - b.y);
	for (const e of sprites) drawEntitySprite(buf, e, cam, style, terrain);
}
