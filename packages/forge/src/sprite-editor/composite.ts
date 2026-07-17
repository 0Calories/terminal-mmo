// The Composited preview (ADR 0031, issue #340): render a work-in-progress
// `.sprite` doc the way the game actually draws it — through the shared renderer
// (`drawEntitySprite`), against the game's real background color, seated at the
// real anchors with real mirroring / recolor / swing-sampling. Art is judged in
// context, not isolation.
//
// The fidelity mechanism is the `SpriteOverrides` seam on `drawEntitySprite`
// (@mmo/render): the frozen id-keyed registries hold the *saved* file, so we
// compile the *live* doc here (`compileBodySprite` / `spriteFromDoc` /
// `compileWeaponSprite`) and inject it as the piece under edit, letting the WIP
// art flow through the identical composition path the game uses — pixel-identical
// by construction, with zero bespoke compositing math in forge.
//
// Per role the composition is:
//   hat     → seated on a default body at the head anchor
//   weapon  → in the default body's hand across idle/windup/active-sweep/recovery
//   form    → the body wearing a default hat + holding weapon 0
//   monster → the sprite rendered plain at game scale (via the `base` override)
//   npc     → same plain single-sprite render
//
// This module is pure (no `@opentui/core`, no I/O): the TUI glue passes a cell
// buffer + style and a `CompositeView` selecting the animation/phase/facing/elapsed.
import { SWING_TOTAL, swingPhase, swingProgress } from '@mmo/core/combat';
import {
	type ActionState,
	BOX,
	DEFAULT_FORM_ID,
	type Entity,
	type EntityType,
	type Facing,
	type RGBAQuad,
} from '@mmo/core/entities';
import { spriteMetaFor } from '@mmo/core/sprites';
import {
	type BodySprite,
	type CellBuffer,
	type ColorFactory,
	compileBodySprite,
	compileWeaponSprite,
	drawEntitySprite,
	FORM_IDS,
	formById,
	HAT_IDS,
	type RenderStyle,
	type Sprite,
	type SpriteDoc,
	type SpriteOverrides,
	spriteFromDoc,
} from '@mmo/render';
import { animationFps, playbackFrame, walkPreviewIndex } from './playback';
import type { SpriteRole } from './templates';

// The base entity type used to render monster/npc art plainly. Its only effect is
// the metadata baseline, which cancels out against the placement math below — the
// sprite lands exactly where we position it regardless of the type chosen.
const PLAIN_TYPE: EntityType = 'chaser';

// A neutral player entity the hat/weapon/form compositions dress up. `hue` is
// the session-selected dynamic `p` variant (spec #401 amendment) — the wire hue
// id the real renderer recolors the body with, 0 = canonical.
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

// The registered default body — the real form a player draws, so a hat/weapon is
// judged on the exact body it will ship on.
function defaultBody(): BodySprite {
	const id = FORM_IDS.includes(DEFAULT_FORM_ID) ? DEFAULT_FORM_ID : FORM_IDS[0];
	return formById(id);
}

// A sensible default hat id for the Form composition (first registered hat).
function defaultHatId(): string {
	return HAT_IDS[0] ?? '';
}

// ---------------------------------------------------------------------------
// Stances — the selectable animations/phases `[`/`]` cycle in `forge sprite preview`.
// ---------------------------------------------------------------------------

export interface PreviewStance {
	// Selection key + label. For non-weapon roles an animation id or the synthetic
	// 'walk'; for weapons a swing phase.
	id: string;
	// Playback rate for a multi-frame stance (0 = single frame / static).
	fps: number;
}

export function previewStances(
	doc: SpriteDoc,
	role: SpriteRole,
): PreviewStance[] {
	if (role === 'weapon') {
		// The Default (rest) frame, then each swing frame — every stance a
		// concrete frame name the phase mapping resolves (ADR 0036).
		const rest = doc.frames[0]?.name ?? 'idle';
		const out: PreviewStance[] = [{ id: rest, fps: 0 }];
		for (const name of doc.animations.swing ?? [])
			out.push({ id: name, fps: 0 });
		return out;
	}
	if (role === 'form') {
		const out: PreviewStance[] = [{ id: 'idle', fps: 0 }];
		if (doc.animations.walk) out.push({ id: 'walk', fps: 0 });
		for (const animation of Object.keys(doc.animations)) {
			if (animation === 'idle' || animation === 'walk') continue;
			out.push({ id: animation, fps: animationFps(doc.fps, animation) });
		}
		return out;
	}
	// hat / monster / npc: one stance per animation (usually just 'idle').
	return Object.keys(doc.animations).map((animation) => ({
		id: animation,
		fps:
			(doc.animations[animation]?.length ?? 1) > 1
				? animationFps(doc.fps, animation)
				: 0,
	}));
}

// ---------------------------------------------------------------------------
// Frame / action resolution
// ---------------------------------------------------------------------------

// Resolve a stance + elapsed time to the concrete frame name to show. Accepts
// an animation id (sampled by its fps), 'walk' (stride-simulated gait, ADR
// 0035), or a bare frame name (shown as-is — how the editor pins the exact
// edited frame).
function resolveFrame(
	doc: SpriteDoc,
	stance: string,
	elapsedS: number,
): string {
	const fallback = doc.frames[0]?.name ?? 'idle';
	if (stance === 'walk' && doc.animations.walk) {
		const frames = doc.animations.walk;
		const idx = walkPreviewIndex(frames.length, elapsedS);
		return frames[idx] ?? fallback;
	}
	const animationFrames = doc.animations[stance];
	if (animationFrames && animationFrames.length > 0) {
		const idx = playbackFrame(
			animationFrames.length,
			elapsedS,
			animationFps(doc.fps, stance),
		);
		return animationFrames[idx] ?? fallback;
	}
	if (doc.frames.some((f) => f.name === stance)) return stance;
	return fallback;
}

// Which swing phase a weapon stance denotes: the phase whose swing slot holds
// that frame name (ADR 0036: windup → 0, active → 1, recovery → 2), or 'idle'
// (the Default/rest frame) for anything else.
const SWING_PHASES = ['windup', 'active', 'recovery'] as const;

function weaponPhaseOf(
	doc: SpriteDoc,
	stance: string,
): 'idle' | 'windup' | 'active' | 'recovery' {
	const i = (doc.animations.swing ?? []).indexOf(stance);
	return i >= 0 && i < 3 ? SWING_PHASES[i] : 'idle';
}

// The entity action seating a weapon in a static phase (elapsed 0), or the live
// swing derived from the game's own timing when animating (elapsed > 0).
function weaponAction(
	doc: SpriteDoc,
	stance: string,
	elapsedS: number,
): ActionState | undefined {
	if (elapsedS > 0) {
		// Loop the full windup→active→recovery swing via the real attackT timeline.
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

// A body whose `idle` animation is re-pointed at `frameName` so a static avatar shows
// exactly that frame — how the preview pins the edited/animated frame — while
// keeping the doc's real grip/head/baseline so a hat and weapon seat correctly.
function bodyShowingFrame(doc: SpriteDoc, frameName: string): BodySprite {
	const full = compileBodySprite(doc);
	return {
		...full,
		frames: { ...full.frames, idle: spriteFromDoc(doc, frameName) },
	};
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface CompositeView {
	facing: Facing;
	// Animation / phase / frame selector (see resolveFrame / weaponPhaseOf).
	stance: string;
	// Seconds of playback elapsed; drives multi-frame animations and the swing loop.
	elapsedS: number;
	// The session-selected dynamic `p` variant (spec #401 amendment): the body
	// hue index the composite avatar wears. Omitted → the canonical hue 0.
	hue?: number;
}

export interface CompositeBuild {
	entity: Entity;
	overrides: SpriteOverrides;
}

// A CellBuffer that draws nothing and records the painted bounding box — how
// `centerByBounds` measures the ACTUAL composed extent (body + hat + weapon)
// through the real renderer, with no per-piece anchor math to drift.
class BoundsBuffer implements CellBuffer<null> {
	readonly width: number;
	readonly height: number;
	minX = Number.POSITIVE_INFINITY;
	minY = Number.POSITIVE_INFINITY;
	maxX = Number.NEGATIVE_INFINITY;
	maxY = Number.NEGATIVE_INFINITY;
	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
	}
	get any(): boolean {
		return this.maxX >= this.minX;
	}
	clear(): void {}
	setCell(x: number, y: number, ch: string): void {
		if (ch === ' ') return;
		this.minX = Math.min(this.minX, x);
		this.minY = Math.min(this.minY, y);
		this.maxX = Math.max(this.maxX, x);
		this.maxY = Math.max(this.maxY, y);
	}
	setCellWithAlphaBlending(x: number, y: number, ch: string): void {
		this.setCell(x, y, ch);
	}
}

// Colours never matter for measuring; every slot is the null colour.
const MEASURE_STYLE: RenderStyle<null> = {
	bg: null,
	terrainFg: null,
	terrainBg: null,
	portal: null,
	transparent: null,
	hurt: null,
	nameplate: null,
	nameplateBg: null,
	palette: {},
	paletteDefault: null,
	cosmetics: { hues: [], nameplates: [], nameplateBgs: [] },
};

// Margin around the measuring buffer so art hanging above/left of the initial
// placement (a tall hat, a raised sword) still lands in-bounds and is counted.
const MEASURE_MARGIN = 16;

// Re-place a built composite so its ACTUAL composed bounds — body plus hat plus
// weapon, whatever the pieces add above or beside the body — center in the
// destination buffer (QA round 3: `placeCentered`'s hat-headroom bias pushed
// the body below the fold of the ~9-row preview pane).
function centerByBounds(
	build: CompositeBuild,
	dims: { width: number; height: number },
): CompositeBuild {
	const measure = new BoundsBuffer(
		dims.width + 2 * MEASURE_MARGIN,
		dims.height + 2 * MEASURE_MARGIN,
	);
	drawEntitySprite(
		measure,
		build.entity,
		{ x: -MEASURE_MARGIN, y: -MEASURE_MARGIN },
		MEASURE_STYLE,
		undefined,
		undefined,
		build.overrides,
	);
	if (!measure.any) return build;
	const bw = measure.maxX - measure.minX + 1;
	const bh = measure.maxY - measure.minY + 1;
	// Where the bbox currently sits in destination coordinates, and where a
	// centered bbox would sit; shift the entity by the difference.
	const atX = measure.minX - MEASURE_MARGIN;
	const atY = measure.minY - MEASURE_MARGIN;
	const wantX = Math.floor((dims.width - bw) / 2);
	const wantY = Math.floor((dims.height - bh) / 2);
	build.entity.x += wantX - atX;
	build.entity.y += wantY - atY;
	return build;
}

// Center a sprite of the given dimensions in a `w`×`h` buffer, returning the
// entity world position that lands it there under `drawEntitySprite`'s placement
// (`sx = e.x - floor((w-BOX.w)/2)`, `sy = e.y + BOX.h - h + baseline`). The
// baseline cancels, so its exact value never matters. Only a first guess:
// `centerByBounds` re-places the build by what actually got drawn.
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

function primary(body: BodySprite): Sprite {
	const idle = body.frames.idle;
	if (idle === undefined)
		throw new Error('composite body is missing its idle frame');
	return Array.isArray(idle) ? idle[0] : (idle as Sprite);
}

// Build the preview entity + overrides for a role/doc/view against a buffer of
// the given size. Returns null when the live doc cannot compile yet (e.g. a Form
// still missing its grip/head anchors) — the caller then shows a bare background.
export function buildComposite(
	doc: SpriteDoc,
	role: SpriteRole,
	view: CompositeView,
	dims: { width: number; height: number },
): CompositeBuild | null {
	const { facing } = view;
	try {
		if (role === 'hat') {
			const body = defaultBody();
			const sprite = primary(body);
			const e = baseAvatar(facing, view.hue ?? 0);
			const pos = placeCentered(
				sprite.w,
				sprite.h,
				body.baseline ?? 0,
				dims.width,
				dims.height,
			);
			e.x = pos.x;
			e.y = pos.y;
			const frame = resolveFrame(doc, view.stance, view.elapsedS);
			return centerByBounds(
				{ entity: e, overrides: { body, hat: spriteFromDoc(doc, frame) } },
				dims,
			);
		}

		if (role === 'weapon') {
			const body = defaultBody();
			const sprite = primary(body);
			const e = baseAvatar(facing, view.hue ?? 0);
			e.weapon = 0;
			const action = weaponAction(doc, view.stance, view.elapsedS);
			if (action) e.action = action;
			const pos = placeCentered(
				sprite.w,
				sprite.h,
				body.baseline ?? 0,
				dims.width,
				dims.height,
			);
			e.x = pos.x;
			e.y = pos.y;
			return centerByBounds(
				{ entity: e, overrides: { body, weapon: compileWeaponSprite(doc) } },
				dims,
			);
		}

		if (role === 'form') {
			const frame = resolveFrame(doc, view.stance, view.elapsedS);
			const body = bodyShowingFrame(doc, frame);
			const sprite = primary(body);
			const e = baseAvatar(facing, view.hue ?? 0);
			e.weapon = 0;
			if (e.cosmetics) e.cosmetics.hat = defaultHatId();
			const pos = placeCentered(
				sprite.w,
				sprite.h,
				body.baseline ?? 0,
				dims.width,
				dims.height,
			);
			e.x = pos.x;
			e.y = pos.y;
			return centerByBounds({ entity: e, overrides: { body } }, dims);
		}

		// monster / npc — plain single-sprite render via the `base` override.
		const frame = resolveFrame(doc, view.stance, view.elapsedS);
		const base = spriteFromDoc(doc, frame);
		const baseline = spriteMetaFor(PLAIN_TYPE).baseline;
		const e: Entity = { ...baseAvatar(facing), type: PLAIN_TYPE };
		e.cosmetics = undefined;
		const pos = placeCentered(
			base.w,
			base.h,
			baseline,
			dims.width,
			dims.height,
		);
		e.x = pos.x;
		e.y = pos.y;
		return centerByBounds({ entity: e, overrides: { base } }, dims);
	} catch {
		// The live doc cannot compile yet (missing required anchors/animations); the
		// preview panel shows a bare background until the artist supplies them.
		return null;
	}
}

// Merge a doc's file-local custom colours into a base render style so the
// Composited preview renders them faithfully (#393). The shared renderer resolves
// a colour key as `recolor?.[key] ?? style.palette[key] ?? style.paletteDefault`;
// file-local keys live only on the doc, so without this merge they fall through to
// `paletteDefault` and the preview lies about the artist's palette. Local keys win
// over the global scene palette, matching the editor's own `resolveColorKey`
// precedence. Returns the base style unchanged when the doc defines no customs, so
// the common case allocates nothing.
export function styleWithLocalColors<C>(
	base: RenderStyle<C>,
	colors: Readonly<Record<string, RGBAQuad>>,
	toColor: ColorFactory<C>,
): RenderStyle<C> {
	const keys = Object.keys(colors);
	if (keys.length === 0) return base;
	const palette: Record<string, C> = { ...base.palette };
	for (const key of keys) {
		const q = colors[key];
		if (q) palette[key] = toColor(q[0], q[1], q[2], q[3]);
	}
	return { ...base, palette };
}

// Render the composited preview into a cell buffer through the shared renderer,
// cleared to the game's real background color first. No terrain is passed, so the
// avatar floats against the background exactly as intended for contrast judging.
export function renderComposite<C>(
	buf: CellBuffer<C>,
	doc: SpriteDoc,
	role: SpriteRole,
	style: RenderStyle<C>,
	view: CompositeView,
): boolean {
	buf.clear(style.bg);
	const built = buildComposite(doc, role, view, {
		width: buf.width,
		height: buf.height,
	});
	if (!built) return false;
	drawEntitySprite(
		buf,
		built.entity,
		{ x: 0, y: 0 },
		style,
		undefined,
		undefined,
		built.overrides,
	);
	return true;
}
