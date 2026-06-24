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
	// `nameplate` is the handle text colour (full opacity); `nameplateWash` is the same
	// dim grey at a low alpha — the translucent pill behind the default handle (#103,
	// ADR 0016). Per-cosmetic pill washes live in `cosmetics.nameplateWashes`.
	nameplate: C;
	nameplateWash: C;
	palette: Readonly<Record<string, C>>;
	paletteDefault: C;
	// Cosmetic catalogs resolved into the colour type (#35), indexed by an Avatar's
	// `Cosmetics` choices: `hues[hue]` recolours the body, `nameplates[nameplate]`
	// colours the handle. Hat art is glyph data (HATS), so it needs no colour here.
	cosmetics: {
		hues: readonly C[];
		nameplates: readonly C[];
		nameplateWashes: readonly C[];
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
			else buf.setCellWithAlphaBlending(px, py, ch, fg, style.transparent);
		}
	}
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
	ghost?: GhostStyle<C>,
): void {
	// The action an entity is performing this frame (ADR 0017 §10): observers read the
	// replicated action-state; the local Avatar predicts its swing from `attackT`. Drives
	// BOTH the body Pose and the weapon frame, so the two layers always agree.
	let move: MoveId;
	let phase: AttackPhase | null;
	let progress: number;
	let staggered: boolean;
	if (e.action) {
		move = e.action.move;
		phase = e.action.phase;
		progress = e.action.progress;
		staggered = (e.action.flags & ACTION_FLAG.staggered) !== 0;
	} else {
		const swing = weaponById(e.weapon).swing;
		phase = swingPhase(e.attackT, swing);
		move = phase ? 'basic' : 'idle';
		progress = phase ? swingProgress(e.attackT, swing) : 0;
		staggered = (e.stunT ?? 0) > 0;
	}

	// The body: an Avatar poses its Form through the shared `bodyFrame` selector and
	// resolves the grid via `formFrame` (ADR 0020), so its body is animated state — not a
	// hardcoded grid — and owner/observer agree frame-for-frame. A Monster keeps its
	// single-frame Sprite until it adopts a BodySprite. This slice authors only `idle`, so
	// every Pose resolves to idle; the per-Form grip/head anchors carry the weapon and hat.
	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	let sprite: Sprite;
	let grip: { x: number; y: number } | undefined;
	let head: { x: number; y: number } | undefined;
	if (body) {
		// Locomotion gait (walk/jump) and emotes are authored in a later slice; until then
		// the body holds idle. `airborne` is wired live (it has a replicated source); the
		// distance-driven walk cycle (ADR 0020 §7) lands with the walk Poses.
		const pose = bodyFrame({
			move,
			phase,
			swingProgress: progress,
			emote: null,
			emoteT: 0,
			airborne: !e.onGround,
			moving: false,
			distanceX: 0,
			staggered,
		});
		sprite = formFrame(body, pose.poseId, pose.frameIndex);
		grip = body.grip;
		head = body.head;
	} else {
		sprite = spriteFor(e.type);
		grip = sprite.grip;
	}

	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	const sy = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const hurt = e.hurtT > 0.3;
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
		blitSprite(buf, hat, hx, hy, e.facing, hurt, style, undefined, ghost);
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

// A Player Avatar's handle, drawn as a 2-row pill chip directly BELOW the Sprite's
// feet (#103, ADR 0016). The pill is:
//
//     ▟ neo ▙   top row: bevelled top corners (▟▙), a pad column each side, and the
//     ▝▀▀▀▀▀▘   handle on top; bottom row: a thin upper-half lip (▀) with rounded ends.
//
// Over terrain the pill body is a faint translucent WASH of the Avatar's cosmetic
// nameplate colour — a tint of the terrain beneath each cell — with the handle drawn on
// top at full opacity. Off terrain the pill is omitted entirely and ONLY the handle
// shows, floating on whatever is behind (so on the Avatar-creation panel, which has no
// terrain, the chip reduces to just the coloured name).
//
// The wash must be laid in two passes per cell: terrain is a foreground `█` block, so a
// cell's background is the dark `terrainBg`, not the bright colour you see. We first
// `setCell` the cell to the solid `terrainFg` base, then alpha-blend the wash over it —
// otherwise the blend would composite over `terrainBg` and stamp a dark box (the root
// failure documented in ADR 0016). Only entities carrying a `name` (co-present Players)
// get a chip; hat height doesn't affect its position now that it sits below the feet.
function drawNameplate<C>(
	buf: CellBuffer<C>,
	e: Entity,
	cam: { x: number; y: number },
	terrain: Terrain,
	style: RenderStyle<C>,
): void {
	if (!e.name) return;
	const idx = e.cosmetics?.nameplate;
	const ink =
		(idx !== undefined ? style.cosmetics.nameplates[idx] : undefined) ??
		style.nameplate;
	const wash =
		(idx !== undefined ? style.cosmetics.nameplateWashes[idx] : undefined) ??
		style.nameplateWash;
	// World cell under a screen cell, matching the terrain layer's whole-cell camera.
	const camX = Math.round(cam.x);
	const camY = Math.round(cam.y);
	const cx = e.x + BOX.w / 2 - cam.x;
	const boxW = e.name.length + 4; // ▟ · pad · handle · pad · ▙
	const left = Math.round(cx - boxW / 2);
	const lastCol = boxW - 1;
	// Top row sits on the row one past the Sprite's last row (directly below the feet);
	// BOX.h - sprite.h + sprite.h == BOX.h, so the chip top is e.y + BOX.h.
	const boxTop = Math.round(e.y + BOX.h - cam.y);

	for (let ry = 0; ry < 2; ry++) {
		const py = boxTop + ry;
		if (py < 0 || py >= buf.height) continue;
		for (let rx = 0; rx < boxW; rx++) {
			const px = left + rx;
			if (px < 0 || px >= buf.width) continue;
			const solid = isSolid(terrain, px + camX, py + camY);
			const nameIdx = rx - 2; // handle occupies columns 2 .. name.length + 1
			const isName = ry === 0 && nameIdx >= 0 && nameIdx < e.name.length;

			if (isName) {
				// Handle glyph at full opacity. Over terrain it sits on the wash (two
				// passes: flatten to the terrain base, then blend the letter over a washed
				// backing); off terrain only the letter shows, over whatever is behind.
				if (solid) {
					buf.setCell(px, py, ' ', style.terrainFg, style.terrainFg);
					buf.setCellWithAlphaBlending(px, py, e.name[nameIdx], ink, wash);
				} else {
					buf.setCellWithAlphaBlending(
						px,
						py,
						e.name[nameIdx],
						ink,
						style.transparent,
					);
				}
				continue;
			}

			// Pill body (bevel corners, side pad, bottom lip): a faint wash of the
			// cosmetic colour, drawn ONLY over terrain. Off terrain it vanishes so the
			// handle floats free.
			if (!solid) continue;
			const glyph =
				ry === 0
					? rx === 0
						? '▟'
						: rx === lastCol
							? '▙'
							: ' '
					: rx === 0
						? '▝'
						: rx === lastCol
							? '▘'
							: '▀';
			// Flatten the cell to the terrain colour so the wash blends over the bright
			// terrain block, not the dark terrainBg behind it (ADR 0016).
			buf.setCell(px, py, ' ', style.terrainFg, style.terrainFg);
			if (glyph === ' ')
				// Solid pad cell: wash the whole cell.
				buf.setCellWithAlphaBlending(px, py, ' ', wash, wash);
			// Bevel/lip glyph: wash its filled quadrants; the empty quadrant keeps the
			// flattened terrain base (transparent bg), reading as a rounded cut.
			else buf.setCellWithAlphaBlending(px, py, glyph, wash, style.transparent);
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
			if (isSolid(terrain, wx, wy) && wx >= 0 && wx < ww && wy >= 0 && wy < wh)
				buf.setCell(sx, sy, '█', style.terrainFg, style.terrainBg);
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
	// gets correct depth without duplicating the rule.
	const sprites = [...scene.entities].sort((a, b) => a.y - b.y);
	for (const e of sprites) {
		drawEntitySprite(buf, e, cam, style);
		drawNameplate(buf, e, cam, terrain, style);
	}
}
