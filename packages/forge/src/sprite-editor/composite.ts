import { loadSpriteSources } from '@mmo/assets';
import {
	ACTION_FLAG,
	bladeEdgeArc,
	SWING_TOTAL,
	swingPhase,
	swingProgress,
	weaponById,
} from '@mmo/core/combat';
import {
	type ActionState,
	type AttackPhase,
	BOX,
	DEFAULT_FORM_ID,
	type Entity,
	type EntityType,
	type Facing,
	type MoveId,
	type RGBAQuad,
	SCENE_COLORS,
	SCENE_PALETTE,
} from '@mmo/core/entities';
import { bodyFrame, mirrorAnchorX, swingFrameIndex } from '@mmo/core/sprites';
import {
	FORM_IDS,
	findFrame,
	frameLabelAt,
	frameLocations,
	HAT_IDS,
	parseSpriteFile,
	type SpriteAnimationDoc,
	type SpriteDoc,
	WEAPON_ACCENT_KEY,
} from '@mmo/render';
import { type Cell, Compositor, type RGBA } from '@mmo/render/compositor';
import {
	type CompiledSprite,
	compileSprite,
	paintSprite,
	type SpritePalette,
} from '@mmo/render/sprites';
import { animationFps, playbackFrame, walkPreviewIndex } from './playback';
import type { SpriteRole } from './templates';

const PLAIN_TYPE: EntityType = 'chaser';

const PALETTE_DEFAULT: RGBA = SCENE_COLORS.paletteDefault;

/**
 * The composite preview composes the sprite being edited through the SAME
 * production compositor and {@link paintSprite} the live client uses (ADR 0038),
 * so authored art cannot disagree with the game. Layers that are not being
 * edited (the default body a hat sits on, the weapon a form holds) load from the
 * shipped catalog; the edited layer is compiled straight from the working doc.
 */

// ── Shipped catalog docs (for the non-edited context layers) ──────────────────

const shippedSources = [...loadSpriteSources().values()];

function shippedDoc(role: string, id: string): SpriteDoc | undefined {
	const source = shippedSources.find((s) => s.role === role && s.id === id);
	if (!source) return undefined;
	const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
	if (doc === null) return undefined;
	if (diagnostics.some((d) => d.severity === 'error')) return undefined;
	return doc;
}

function defaultFormDoc(): SpriteDoc | undefined {
	const id = FORM_IDS.includes(DEFAULT_FORM_ID) ? DEFAULT_FORM_ID : FORM_IDS[0];
	return id ? shippedDoc('forms', id) : undefined;
}

function defaultHatDoc(): SpriteDoc | undefined {
	const id = HAT_IDS[0];
	return id ? shippedDoc('hats', id) : undefined;
}

function defaultWeaponDoc(): SpriteDoc | undefined {
	return shippedDoc('weapons', weaponById(0).sprite);
}

// ── Palette / style (8-bit; the compositor's colour model) ────────────────────

export interface CompositeStyle {
	readonly palette: SpritePalette;
	readonly paletteDefault: RGBA;
}

export function baseCompositeStyle(): CompositeStyle {
	return { palette: SCENE_PALETTE, paletteDefault: PALETTE_DEFAULT };
}

/** Merge local colour-key overrides (doc colours, dynamic p/a previews) into a
 *  style's palette without mutating the base. */
export function styleWithLocalColors(
	base: CompositeStyle,
	colors: Readonly<Record<string, RGBAQuad>>,
): CompositeStyle {
	const keys = Object.keys(colors);
	if (keys.length === 0) return base;
	const palette: Record<string, RGBA> = { ...base.palette };
	for (const key of keys) {
		const q = colors[key];
		if (q) palette[key] = [q[0], q[1], q[2], q[3]];
	}
	return { palette, paletteDefault: base.paletteDefault };
}

// ── Preview stances (which frames the preview cycles through) ─────────────────

export interface PreviewStance {
	id: string;
	fps: number;
}

function swingAnimation(doc: SpriteDoc): SpriteAnimationDoc | undefined {
	return doc.animations.find((a) => a.name === 'swing');
}

function defaultFrameLabel(doc: SpriteDoc): string {
	return frameLocations(doc)[0]?.label ?? 'idle';
}

export function previewStances(
	doc: SpriteDoc,
	role: SpriteRole,
): PreviewStance[] {
	if (role === 'weapon') {
		const out: PreviewStance[] = [{ id: defaultFrameLabel(doc), fps: 0 }];
		const swing = swingAnimation(doc);
		if (swing)
			swing.frames.forEach((_, i) => {
				out.push({ id: frameLabelAt(swing, i), fps: 0 });
			});
		return out;
	}
	if (role === 'form') {
		const out: PreviewStance[] = [{ id: 'idle', fps: 0 }];
		if (doc.animations.some((a) => a.name === 'walk'))
			out.push({ id: 'walk', fps: 0 });
		for (const animation of doc.animations) {
			if (animation.name === 'idle' || animation.name === 'walk') continue;
			out.push({ id: animation.name, fps: animationFps(doc, animation.name) });
		}
		return out;
	}

	return doc.animations.map((animation) => ({
		id: animation.name,
		fps: animation.frames.length > 1 ? animationFps(doc, animation.name) : 0,
	}));
}

function resolveFrame(
	doc: SpriteDoc,
	stance: string,
	elapsedS: number,
): string {
	const fallback = defaultFrameLabel(doc);
	const walk = doc.animations.find((a) => a.name === 'walk');
	if (stance === 'walk' && walk) {
		const idx = walkPreviewIndex(walk.frames.length, elapsedS);
		return frameLabelAt(walk, idx);
	}
	const animation = doc.animations.find((a) => a.name === stance);
	if (animation && animation.frames.length > 0) {
		const idx = playbackFrame(
			animation.frames.length,
			elapsedS,
			animationFps(doc, stance),
		);
		return frameLabelAt(animation, idx);
	}
	if (findFrame(doc, stance) !== undefined) return stance;
	return fallback;
}

const SWING_PHASES = ['windup', 'active', 'recovery'] as const;

function weaponPhaseOf(
	doc: SpriteDoc,
	stance: string,
): 'idle' | 'windup' | 'active' | 'recovery' {
	const swing = swingAnimation(doc);
	if (!swing) return 'idle';
	const i = swing.frames.findIndex(
		(_, idx) => frameLabelAt(swing, idx) === stance,
	);
	return i >= 0 && i < 3 ? SWING_PHASES[i] : 'idle';
}

function weaponAction(
	doc: SpriteDoc,
	stance: string,
	elapsedS: number,
): ActionState | undefined {
	if (elapsedS > 0) {
		const t = elapsedS % SWING_TOTAL;
		const attackT = SWING_TOTAL - t;
		const phase = swingPhase(attackT);
		if (!phase) return undefined;
		return {
			move: 'basic',
			phase,
			progress: swingProgress(attackT),
			flags: 0,
			emote: null,
			emoteT: 0,
		};
	}
	const phase = weaponPhaseOf(doc, stance);
	if (phase === 'idle') return undefined;
	return {
		move: 'basic',
		phase,
		progress: 0.5,
		flags: 0,
		emote: null,
		emoteT: 0,
	};
}

// ── Entity animation state (mirrors the production sprite pipeline) ───────────

interface AnimState {
	move: MoveId;
	phase: AttackPhase | null;
	progress: number;
	staggered: boolean;
	emote: string | null;
	emoteT: number;
}

function animStateOf(e: Entity): AnimState {
	if (e.action)
		return {
			move: e.action.move,
			phase: e.action.phase,
			progress: e.action.progress,
			staggered: (e.action.flags & ACTION_FLAG.staggered) !== 0,
			emote: e.action.emote,
			emoteT: e.action.emoteT,
		};
	const phase = swingPhase(e.attackT);
	return {
		move: phase ? 'basic' : 'idle',
		phase,
		progress: phase ? swingProgress(e.attackT) : 0,
		staggered: (e.stunT ?? 0) > 0,
		emote: e.emoteId ?? null,
		emoteT: e.emoteT ?? 0,
	};
}

function fpsFor(doc: SpriteDoc): Record<string, number> {
	const fps: Record<string, number> = {};
	for (const a of doc.animations) if (a.fps !== undefined) fps[a.name] = a.fps;
	return fps;
}

function walkFrameCount(doc: SpriteDoc): number {
	return doc.animations.find((a) => a.name === 'walk')?.frames.length ?? 1;
}

function bodyFrameLabel(
	doc: SpriteDoc,
	animationId: string,
	frameIndex: number,
): string | undefined {
	const anim =
		doc.animations.find((a) => a.name === animationId) ??
		doc.animations.find((a) => a.name === 'idle');
	if (anim === undefined) return undefined;
	const n = anim.frames.length;
	const idx = ((frameIndex % n) + n) % n;
	return frameLabelAt(anim, idx);
}

/** The body frame the production pipeline would show for this entity + doc. */
function animatedBodyLabel(doc: SpriteDoc, e: Entity): string | undefined {
	const st = animStateOf(e);
	const anim = bodyFrame(
		{
			move: st.move,
			phase: st.phase,
			swingProgress: st.progress,
			emote: st.emote,
			emoteT: st.emoteT,
			airborne: !e.onGround,
			moving: e.vx !== 0,
			distanceX: e.x,
			staggered: st.staggered,
		},
		fpsFor(doc),
		walkFrameCount(doc),
	);
	return bodyFrameLabel(doc, anim.animationId, anim.frameIndex);
}

// ── Composition plan ──────────────────────────────────────────────────────────

interface Layer {
	sprite: CompiledSprite;
	cellX: number;
	cellY: number;
	facing: Facing;
}

interface Arc {
	x: number;
	y: number;
	char: string;
	color: RGBA;
}

export interface CompositeView {
	facing: Facing;
	stance: string;
	elapsedS: number;
	hue?: number;
}

export interface CompositeBuild {
	entity: Entity;
	layers: Layer[];
	arcs: Arc[];
}

function baseAvatar(facing: Facing, hue = 0): Entity {
	return {
		id: 1,
		type: 'player',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
		cosmetics: { hue, hat: '', nameplate: 0, form: DEFAULT_FORM_ID },
	};
}

/** The layers + primary sprite for a role, resolved as a function of the entity's
 *  final placement so centring can re-derive them after measuring. */
interface RoleContext {
	entity: Entity;
	primary: CompiledSprite;
	baseline: number;
	render(e: Entity, style: CompositeStyle): { layers: Layer[]; arcs: Arc[] };
}

function bodyOrigin(
	e: Entity,
	sprite: CompiledSprite,
	baseline: number,
): { sx: number; sy: number } {
	const bodyW = sprite.widthCells;
	return {
		sx: Math.round(e.x - Math.floor((bodyW - BOX.w) / 2)),
		sy: Math.round(e.y + BOX.h - sprite.heightCells + baseline),
	};
}

function weaponLayerAndArc(
	weaponDoc: SpriteDoc,
	e: Entity,
	body: CompiledSprite,
	sx: number,
	sy: number,
	style: CompositeStyle,
): { layer?: Layer; arcs: Arc[] } {
	const grip = body.anchors.grip;
	const wGrip = weaponDoc.anchors.grip;
	if (!grip || !wGrip) return { arcs: [] };
	const st = animStateOf(e);
	const swinging = st.move === 'basic' && st.phase !== null;
	const label = swinging
		? `swing ${swingFrameIndex(st.phase as AttackPhase)}`
		: frameLabelAt(weaponDoc.animations[0], 0);
	const frame = compileSprite(weaponDoc, label);
	const bodyW = body.widthCells;
	const bodyGripX = sx + mirrorAnchorX(grip.x, bodyW, e.facing);
	const bodyGripY = sy + grip.y;
	const wgx = e.facing === 1 ? wGrip.x : frame.widthCells - 1 - wGrip.x;
	const layer: Layer = {
		sprite: frame,
		cellX: bodyGripX - wgx,
		cellY: bodyGripY - wGrip.y,
		facing: e.facing,
	};
	const arcs: Arc[] = [];
	if (st.phase === 'active') {
		const accent = style.palette[WEAPON_ACCENT_KEY] ?? style.paletteDefault;
		for (const c of bladeEdgeArc(st.progress, e.facing))
			arcs.push({
				x: bodyGripX + c.dx,
				y: bodyGripY + c.dy,
				char: c.glyph,
				color: accent,
			});
	}
	return { layer, arcs };
}

function hatLayer(
	hat: CompiledSprite,
	e: Entity,
	body: CompiledSprite,
	sx: number,
	sy: number,
): Layer {
	const bodyW = body.widthCells;
	const head = body.anchors.head;
	const headX = head ? mirrorAnchorX(head.x, bodyW, e.facing) : (bodyW - 1) / 2;
	return {
		sprite: hat,
		cellX: sx + Math.round(headX - (hat.widthCells - 1) / 2),
		cellY: sy + (head?.y ?? 0) - hat.heightCells,
		facing: e.facing,
	};
}

function roleContext(
	doc: SpriteDoc,
	role: SpriteRole,
	view: CompositeView,
): RoleContext | undefined {
	const { facing } = view;

	if (role === 'hat') {
		const bodyDoc = defaultFormDoc();
		if (!bodyDoc) return undefined;
		const e = baseAvatar(facing, view.hue ?? 0);
		const body = compileSprite(bodyDoc, animatedBodyLabel(bodyDoc, e));
		const hatFrame = resolveFrame(doc, view.stance, view.elapsedS);
		return {
			entity: e,
			primary: body,
			baseline: body.baseline,
			render(entity) {
				const { sx, sy } = bodyOrigin(entity, body, body.baseline);
				const hat = compileSprite(doc, hatFrame);
				return {
					layers: [
						{ sprite: body, cellX: sx, cellY: sy, facing },
						hatLayer(hat, entity, body, sx, sy),
					],
					arcs: [],
				};
			},
		};
	}

	if (role === 'weapon') {
		const bodyDoc = defaultFormDoc();
		if (!bodyDoc) return undefined;
		const e = baseAvatar(facing, view.hue ?? 0);
		e.weapon = 0;
		const action = weaponAction(doc, view.stance, view.elapsedS);
		if (action) e.action = action;
		const body = compileSprite(bodyDoc, animatedBodyLabel(bodyDoc, e));
		return {
			entity: e,
			primary: body,
			baseline: body.baseline,
			render(entity, style) {
				const { sx, sy } = bodyOrigin(entity, body, body.baseline);
				const { layer, arcs } = weaponLayerAndArc(
					doc,
					entity,
					body,
					sx,
					sy,
					style,
				);
				const layers: Layer[] = [
					{ sprite: body, cellX: sx, cellY: sy, facing },
				];
				if (layer) layers.push(layer);
				return { layers, arcs };
			},
		};
	}

	if (role === 'form') {
		const frame = resolveFrame(doc, view.stance, view.elapsedS);
		const body = compileSprite(doc, frame);
		const e = baseAvatar(facing, view.hue ?? 0);
		e.weapon = 0;
		const hatDoc = defaultHatDoc();
		const weaponDoc = defaultWeaponDoc();
		return {
			entity: e,
			primary: body,
			baseline: body.baseline,
			render(entity, style) {
				const { sx, sy } = bodyOrigin(entity, body, body.baseline);
				const layers: Layer[] = [
					{ sprite: body, cellX: sx, cellY: sy, facing },
				];
				let arcs: Arc[] = [];
				if (weaponDoc) {
					const w = weaponLayerAndArc(weaponDoc, entity, body, sx, sy, style);
					if (w.layer) layers.push(w.layer);
					arcs = w.arcs;
				}
				if (hatDoc) {
					const hat = compileSprite(hatDoc);
					layers.push(hatLayer(hat, entity, body, sx, sy));
				}
				return { layers, arcs };
			},
		};
	}

	// monster / npc: the edited sprite is the whole actor.
	const frame = resolveFrame(doc, view.stance, view.elapsedS);
	const base = compileSprite(doc, frame);
	const baseline = doc.baseline;
	const e: Entity = { ...baseAvatar(facing), type: PLAIN_TYPE };
	e.cosmetics = undefined;
	return {
		entity: e,
		primary: base,
		baseline,
		render(entity) {
			const { sx, sy } = bodyOrigin(entity, base, baseline);
			return {
				layers: [{ sprite: base, cellX: sx, cellY: sy, facing }],
				arcs: [],
			};
		},
	};
}

// ── Placement + centring ──────────────────────────────────────────────────────

const MEASURE_MARGIN = 16;

function placeCentered(
	w: number,
	h: number,
	baseline: number,
	bufW: number,
	bufH: number,
): { x: number; y: number } {
	const sx = Math.floor((bufW - w) / 2);
	const sy = Math.max(3, Math.floor((bufH - h) / 2));
	return {
		x: sx + Math.floor((w - BOX.w) / 2),
		y: sy + BOX.h - h + baseline,
	};
}

function paintLayers(
	compositor: Compositor,
	layers: readonly Layer[],
	arcs: readonly Arc[],
	style: CompositeStyle,
): void {
	for (const l of layers)
		paintSprite(compositor, l.sprite, {
			cellX: l.cellX,
			cellY: l.cellY,
			facing: l.facing,
			palette: style.palette,
			paletteDefault: style.paletteDefault,
		});
	for (const a of arcs) compositor.stampGlyph(a.x, a.y, a.char, a.color);
}

/** Ink bounds of a composed surface (non-space cells), or null when empty. */
function inkBounds(
	rows: readonly (readonly Cell[])[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let y = 0; y < rows.length; y++)
		for (let x = 0; x < rows[y].length; x++)
			if (rows[y][x].char !== ' ') {
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
	return maxX >= minX ? { minX, minY, maxX, maxY } : null;
}

function centerByBounds(
	ctx: RoleContext,
	dims: { width: number; height: number },
	style: CompositeStyle,
): void {
	const e = ctx.entity;
	const measure = new Compositor(
		dims.width + 2 * MEASURE_MARGIN,
		dims.height + 2 * MEASURE_MARGIN,
	);
	const shifted: Entity = {
		...e,
		x: e.x + MEASURE_MARGIN,
		y: e.y + MEASURE_MARGIN,
	};
	const { layers, arcs } = ctx.render(shifted, style);
	paintLayers(measure, layers, arcs, style);
	const bounds = inkBounds(measure.surface());
	if (!bounds) return;
	const bw = bounds.maxX - bounds.minX + 1;
	const bh = bounds.maxY - bounds.minY + 1;
	const atX = bounds.minX - MEASURE_MARGIN;
	const atY = bounds.minY - MEASURE_MARGIN;
	const wantX = Math.floor((dims.width - bw) / 2);
	const wantY = Math.floor((dims.height - bh) / 2);
	e.x += wantX - atX;
	e.y += wantY - atY;
}

export function buildComposite(
	doc: SpriteDoc,
	role: SpriteRole,
	view: CompositeView,
	dims: { width: number; height: number },
	style: CompositeStyle = baseCompositeStyle(),
): CompositeBuild | null {
	try {
		const ctx = roleContext(doc, role, view);
		if (!ctx) return null;
		const pos = placeCentered(
			ctx.primary.widthCells,
			ctx.primary.heightCells,
			ctx.baseline,
			dims.width,
			dims.height,
		);
		ctx.entity.x = pos.x;
		ctx.entity.y = pos.y;
		centerByBounds(ctx, dims, style);
		const { layers, arcs } = ctx.render(ctx.entity, style);
		return { entity: ctx.entity, layers, arcs };
	} catch {
		return null;
	}
}

/**
 * Compose the whole preview into a fresh {@link Compositor} sized to `dims` and
 * return its surface, or null when the sprite cannot composite yet. Callers
 * encode the surface to their own target (OpenTUI or text).
 */
export function renderComposite(
	doc: SpriteDoc,
	role: SpriteRole,
	style: CompositeStyle,
	view: CompositeView,
	dims: { width: number; height: number },
): Cell[][] | null {
	const built = buildComposite(doc, role, view, dims, style);
	if (!built) return null;
	const compositor = new Compositor(dims.width, dims.height);
	paintLayers(compositor, built.layers, built.arcs, style);
	return compositor.surface();
}

// ── Plain single-frame capture (canvas modal onion-skin) ──────────────────────

export interface PlainFrameCell {
	ch: string;
	fg: RGBA;
	bg: RGBA | null;
}

export interface PlainFrame {
	w: number;
	h: number;
	at(cx: number, cy: number): PlainFrameCell | null;
}

/**
 * Compose one plain frame of a doc (no body/hat/weapon assembly) into a
 * Compositor sized to the frame and expose it cell-by-cell. Transparent cells
 * read as null; a glyph with no composed backdrop reports `bg: null` so the
 * caller can lay its own checkerboard beneath.
 */
export function renderPlainFrame(
	doc: SpriteDoc,
	frameLabel: string | undefined,
	style: CompositeStyle,
): PlainFrame | null {
	let sprite: CompiledSprite;
	try {
		sprite = compileSprite(doc, frameLabel);
	} catch {
		return null;
	}
	const w = sprite.widthCells;
	const h = sprite.heightCells;
	if (w <= 0 || h <= 0) return { w: 0, h: 0, at: () => null };
	const compositor = new Compositor(w, h);
	paintSprite(compositor, sprite, {
		cellX: 0,
		cellY: 0,
		facing: 1,
		palette: style.palette,
		paletteDefault: style.paletteDefault,
	});
	const rows = compositor.surface();
	return {
		w,
		h,
		at(cx, cy) {
			if (cx < 0 || cx >= w || cy < 0 || cy >= h) return null;
			const cell = rows[cy][cx];
			if (cell.char === ' ' && cell.fg[3] === 0) return null;
			return {
				ch: cell.char,
				fg: cell.fg,
				bg: cell.bg[3] > 0 ? cell.bg : null,
			};
		},
	};
}
