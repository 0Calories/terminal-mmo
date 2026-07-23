import { loadSpriteSources } from '@mmo/assets';
import {
	ACTION_FLAG,
	bladeEdgeArc,
	swingPhase,
	swingProgress,
	weaponById,
} from '@mmo/core/combat';
import {
	type AttackPhase,
	BOX,
	DEFAULT_FORM_ID,
	type Entity,
	HUES,
	type MoveId,
	type Npc,
	SCENE_COLORS,
	SCENE_PALETTE,
} from '@mmo/core/entities';
import {
	bodyFrame,
	MONSTER_SPRITE_REF,
	mirrorAnchorX,
	NPC_SPRITE_REF,
	swingFrameIndex,
} from '@mmo/core/sprites';
import type { Compositor, RGBA } from '../compositor';
import { frameLabelAt, parseSpriteFile, type SpriteDoc } from '../sprite-file';
import { acceptSprite } from '../sprite-validate';
import { WEAPON_ACCENT_KEY } from '../weapon-sprite';
import {
	type CompiledSprite,
	compileSprite,
	type SpritePalette,
} from './compile';
import { paintSprite } from './paint';

/**
 * Actors composed natively into the sub-cell {@link Compositor} (ADR 0038):
 * body, weapon, and hat assemble through {@link paintSprite} so overlapping
 * quadrants reveal the real scene beneath instead of a guessed backdrop. The
 * registries retain the parsed docs and memoize one {@link CompiledSprite} per
 * (role, id, frame), leaving the existing `BodySprite`/`Sprite` accessors intact.
 */

const PALETTE: SpritePalette = SCENE_PALETTE;
const PALETTE_DEFAULT: RGBA = SCENE_COLORS.paletteDefault;
const HURT: RGBA = SCENE_COLORS.hurt;
const HUE_RGBA: readonly RGBA[] = HUES;

const sources = [...loadSpriteSources().values()];

function docsForRole(role: string): Map<string, SpriteDoc> {
	const docs = new Map<string, SpriteDoc>();
	for (const source of sources) {
		if (source.role !== role) continue;
		const doc = acceptSprite(source, role);
		if (doc !== null) docs.set(source.id, doc);
	}
	return docs;
}

const formDocs = docsForRole('forms');
const monsterDocs = docsForRole('monsters');
const npcDocs = docsForRole('npcs');
const weaponDocs = docsForRole('weapons');

const hatDocs = ((): Map<string, SpriteDoc> => {
	const docs = new Map<string, SpriteDoc>();
	for (const source of sources) {
		if (source.role !== 'hats') continue;
		const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
		if (doc === null) continue;
		if (diagnostics.some((d) => d.severity === 'error')) continue;
		docs.set(source.id, doc);
	}
	return docs;
})();

const compiledCache = new Map<string, CompiledSprite>();

function compiled(
	cacheKey: string,
	doc: SpriteDoc,
	label: string | undefined,
): CompiledSprite {
	let sprite = compiledCache.get(cacheKey);
	if (sprite === undefined) {
		sprite = compileSprite(doc, label);
		compiledCache.set(cacheKey, sprite);
	}
	return sprite;
}

const PLACEHOLDER_DOC: SpriteDoc = {
	id: 'placeholder',
	key: 'p',
	baseline: 0,
	anchors: {},
	colors: {},
	animations: [
		{
			name: 'idle',
			frames: [{ rows: ['·'], colors: ['p'], bg: [' '], anchors: {} }],
		},
	],
};
let placeholderSprite: CompiledSprite | null = null;
function placeholder(): CompiledSprite {
	placeholderSprite ??= compileSprite(PLACEHOLDER_DOC);
	return placeholderSprite;
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

const keyCache = new WeakMap<CompiledSprite, Set<string>>();
function usedKeys(sprite: CompiledSprite): Set<string> {
	let keys = keyCache.get(sprite);
	if (keys === undefined) {
		keys = new Set<string>();
		for (const side of [sprite.right, sprite.left]) {
			for (const p of side.pixels) keys.add(p.key);
			for (const g of side.glyphs) {
				keys.add(g.fgKey);
				if (g.bgKey !== undefined) keys.add(g.bgKey);
			}
		}
		keyCache.set(sprite, keys);
	}
	return keys;
}

const hurtCache = new WeakMap<CompiledSprite, SpritePalette>();
function hurtRecolor(sprite: CompiledSprite): SpritePalette {
	let recolor = hurtCache.get(sprite);
	if (recolor === undefined) {
		const map: Record<string, RGBA> = {};
		for (const key of usedKeys(sprite)) map[key] = HURT;
		recolor = map;
		hurtCache.set(sprite, recolor);
	}
	return recolor;
}

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

interface Body {
	sprite: CompiledSprite;
	baseline: number;
}

function formDocFor(e: Entity): SpriteDoc | undefined {
	return formDocs.get(e.cosmetics?.form ?? '') ?? formDocs.get(DEFAULT_FORM_ID);
}

/** The body baseline {@link paintActor} plants feet with — always the sprite
 *  doc's, the single source of truth: the Form doc for players, else the
 *  monster doc. */
function bodyBaseline(e: Entity): number {
	if (e.type === 'player') return formDocFor(e)?.baseline ?? 0;
	return monsterDocs.get(MONSTER_SPRITE_REF[e.type])?.baseline ?? 0;
}

/**
 * World-y of an actor's visually planted feet: the collision box bottom shifted
 * by the body baseline, independent of sprite height (taller sprites extend
 * upward). This is a visual anchor (nameplates), NOT the pass-3 sort key —
 * baseline is foot-art idiom, not scene depth; ordering uses {@link actorDepthY}.
 */
export function actorFootDepth(e: Entity): number {
	return e.y + BOX.h + bodyBaseline(e);
}

/** Pass-3 depth key of an actor: the collision box bottom. Every planted
 *  sprite's deepest ink lands half a cell below it regardless of baseline, so
 *  box bottom alone orders the crowd and same-floor actors tie exactly. */
export function actorDepthY(e: Entity): number {
	return e.y + BOX.h;
}

/** Pass-3 depth key of an NPC: its box bottom, symmetric with {@link actorDepthY}. */
export function npcDepthY(n: Npc): number {
	return n.y + n.h;
}

function resolveBody(e: Entity, st: AnimState): Body {
	if (e.type === 'player') {
		const doc = formDocFor(e);
		if (doc === undefined) return { sprite: placeholder(), baseline: 0 };
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
		const label = bodyFrameLabel(doc, anim.animationId, anim.frameIndex);
		return {
			sprite: compiled(`forms:${doc.id}:${label}`, doc, label),
			baseline: doc.baseline,
		};
	}
	const ref = MONSTER_SPRITE_REF[e.type];
	const doc = monsterDocs.get(ref);
	return {
		sprite: doc ? compiled(`monsters:${ref}:idle`, doc, 'idle') : placeholder(),
		baseline: doc?.baseline ?? 0,
	};
}

function paintWeapon(
	compositor: Compositor,
	e: Entity,
	originPx: number,
	originPy: number,
	bodyW: number,
	grip: { x: number; y: number },
	st: AnimState,
	hurt: boolean,
	tint: RGBA | undefined,
): void {
	if (e.weapon === undefined) return;
	const ref = weaponById(e.weapon).sprite;
	const doc = weaponDocs.get(ref);
	if (doc === undefined) return;
	const wGrip = doc.anchors.grip;
	if (wGrip === undefined) return;

	const accentKey = doc.accent ?? WEAPON_ACCENT_KEY;
	const accent = PALETTE[accentKey] ?? PALETTE_DEFAULT;

	const swinging = st.move === 'basic' && st.phase !== null;
	const label = swinging
		? `swing ${swingFrameIndex(st.phase as AttackPhase)}`
		: frameLabelAt(doc.animations[0], 0);
	const frame = compiled(`weapons:${ref}:${label}`, doc, label);

	// The grip anchors are sprite-space cell offsets; the weapon shares the body's
	// one Pixel origin so the assembled parts never separate at a half-cell offset.
	const gripCellX = mirrorAnchorX(grip.x, bodyW, e.facing);
	const wgx = e.facing === 1 ? wGrip.x : frame.widthCells - 1 - wGrip.x;
	const recolor: SpritePalette = hurt
		? hurtRecolor(frame)
		: { [WEAPON_ACCENT_KEY]: accent };
	paintSprite(compositor, frame, {
		originPx: originPx + (gripCellX - wgx) * 2,
		originPy: originPy + (grip.y - wGrip.y) * 2,
		facing: e.facing,
		palette: PALETTE,
		paletteDefault: PALETTE_DEFAULT,
		recolor,
		...(tint ? { tint } : {}),
	});

	if (st.phase === 'active') {
		// Blade-arc glyphs are cell-snapped to the body's nearest cell origin.
		const gripScreenX = Math.round(originPx / 2) + gripCellX;
		const gripScreenY = Math.round(originPy / 2) + grip.y;
		for (const c of bladeEdgeArc(st.progress, e.facing))
			compositor.stampGlyph(
				gripScreenX + c.dx,
				gripScreenY + c.dy,
				c.glyph,
				tint ?? accent,
			);
	}
}

function paintHat(
	compositor: Compositor,
	e: Entity,
	originPx: number,
	originPy: number,
	bodyW: number,
	head: { x: number; y: number } | undefined,
	hurt: boolean,
	tint: RGBA | undefined,
): void {
	const hatId = e.cosmetics?.hat;
	if (hatId === undefined) return;
	const doc = hatDocs.get(hatId);
	if (doc === undefined) return;
	const hat = compiled(`hats:${hatId}`, doc, undefined);

	// The head anchor is a sprite-space cell offset; the hat shares the body's one
	// Pixel origin (a constant Pixel offset) so it never separates from the body.
	const headX = head ? mirrorAnchorX(head.x, bodyW, e.facing) : (bodyW - 1) / 2;
	const dxPx = Math.round((headX - (hat.widthCells - 1) / 2) * 2);
	const dyPx = ((head?.y ?? 0) - hat.heightCells) * 2;
	const recolor = hurt ? hurtRecolor(hat) : undefined;
	paintSprite(compositor, hat, {
		originPx: originPx + dxPx,
		originPy: originPy + dyPx,
		facing: e.facing,
		palette: PALETTE,
		paletteDefault: PALETTE_DEFAULT,
		...(recolor ? { recolor } : {}),
		...(tint ? { tint } : {}),
	});
}

/** Paint an assembled actor or NPC as a flat translucent silhouette instead of
 *  its real colours — a placement ghost for the Forge zone editor. */
export interface PaintActorOptions {
	readonly tint?: RGBA;
}

/**
 * Compose one actor (local Avatar, remote Avatar, or Monster) atomically into
 * the shared surface: body, then grip-anchored weapon and blade arc, then hat.
 * Hurt tint and cosmetic hue thread through {@link paintSprite}'s recolor. An
 * optional {@link PaintActorOptions.tint} paints the whole actor as one flat
 * silhouette.
 */
export function paintActor(
	compositor: Compositor,
	e: Entity,
	cam: { x: number; y: number },
	opts?: PaintActorOptions,
): void {
	const st = animStateOf(e);
	const { sprite, baseline } = resolveBody(e, st);
	const bodyW = sprite.widthCells;
	// Quantize the combined world-relative offset ONCE into a Pixel origin (2 Pixels
	// per cell) so camera and entity never round independently (ADR 0038). Body,
	// weapon, and hat all share this origin, so the assembled actor moves as one.
	const worldX = e.x - Math.floor((bodyW - BOX.w) / 2);
	const worldY = e.y + BOX.h - sprite.heightCells + baseline;
	const originPx = Math.round((worldX - cam.x) * 2);
	const originPy = Math.round((worldY - cam.y) * 2);
	const hurt = e.hurtT > 0.3;
	const tint = opts?.tint;
	const grip = sprite.anchors.grip;
	const head = sprite.anchors.head;

	const hue =
		e.type === 'player' && e.cosmetics ? HUE_RGBA[e.cosmetics.hue] : undefined;
	const bodyRecolor: SpritePalette | undefined = hurt
		? hurtRecolor(sprite)
		: hue !== undefined
			? { p: hue }
			: undefined;
	paintSprite(compositor, sprite, {
		originPx,
		originPy,
		facing: e.facing,
		palette: PALETTE,
		paletteDefault: PALETTE_DEFAULT,
		...(bodyRecolor ? { recolor: bodyRecolor } : {}),
		...(tint ? { tint } : {}),
	});

	if (grip)
		paintWeapon(compositor, e, originPx, originPy, bodyW, grip, st, hurt, tint);
	paintHat(compositor, e, originPx, originPy, bodyW, head, hurt, tint);
}

/** Compose a stationary NPC's idle sprite, centred on its box like the sim. An
 *  optional {@link PaintActorOptions.tint} paints it as a flat silhouette. */
export function paintNpc(
	compositor: Compositor,
	n: Npc,
	cam: { x: number; y: number },
	opts?: PaintActorOptions,
): void {
	const ref = NPC_SPRITE_REF[n.kind];
	const doc = npcDocs.get(ref);
	const sprite = doc
		? compiled(`npcs:${ref}:idle`, doc, 'idle')
		: placeholder();
	// One combined-transform quantization into a Pixel origin (ADR 0038).
	const worldX = n.x + Math.floor((n.w - sprite.widthCells) / 2);
	const worldY = n.y + n.h - sprite.heightCells + (doc?.baseline ?? 0);
	const originPx = Math.round((worldX - cam.x) * 2);
	const originPy = Math.round((worldY - cam.y) * 2);
	paintSprite(compositor, sprite, {
		originPx,
		originPy,
		facing: 1,
		palette: PALETTE,
		paletteDefault: PALETTE_DEFAULT,
		...(opts?.tint ? { tint: opts.tint } : {}),
	});
}
