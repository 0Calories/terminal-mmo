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
	findFrame,
	formById,
	frameLabelAt,
	frameLocations,
	HAT_IDS,
	type RenderStyle,
	type Sprite,
	type SpriteAnimationDoc,
	type SpriteDoc,
	type SpriteOverrides,
	spriteFromDoc,
} from '@mmo/render';
import { animationFps, playbackFrame, walkPreviewIndex } from './playback';
import type { SpriteRole } from './templates';

const PLAIN_TYPE: EntityType = 'chaser';

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

function defaultBody(): BodySprite {
	const id = FORM_IDS.includes(DEFAULT_FORM_ID) ? DEFAULT_FORM_ID : FORM_IDS[0];
	return formById(id);
}

function defaultHatId(): string {
	return HAT_IDS[0] ?? '';
}

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

function bodyShowingFrame(doc: SpriteDoc, frameName: string): BodySprite {
	const full = compileBodySprite(doc);
	return {
		...full,
		frames: { ...full.frames, idle: spriteFromDoc(doc, frameName) },
	};
}

export interface CompositeView {
	facing: Facing;

	stance: string;

	elapsedS: number;

	hue?: number;
}

export interface CompositeBuild {
	entity: Entity;
	overrides: SpriteOverrides;
}

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

const MEASURE_MARGIN = 16;

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

	const atX = measure.minX - MEASURE_MARGIN;
	const atY = measure.minY - MEASURE_MARGIN;
	const wantX = Math.floor((dims.width - bw) / 2);
	const wantY = Math.floor((dims.height - bh) / 2);
	build.entity.x += wantX - atX;
	build.entity.y += wantY - atY;
	return build;
}

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
		return null;
	}
}

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

export interface PlainFrameCell<C> {
	ch: string;
	fg: C;
	bg: C | null;
}

export interface PlainFrame<C> {
	w: number;
	h: number;
	at(cx: number, cy: number): PlainFrameCell<C> | null;
}

class PlainCapture<C> implements CellBuffer<C> {
	readonly width: number;
	readonly height: number;
	private readonly cells: (PlainFrameCell<C> | null)[];
	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
		this.cells = new Array(Math.max(0, w * h)).fill(null);
	}
	clear(): void {}
	private put(x: number, y: number, cell: PlainFrameCell<C> | null): void {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
		this.cells[y * this.width + x] = cell;
	}
	setCell(x: number, y: number, ch: string, fg: C, bg: C): void {
		this.put(x, y, ch === ' ' ? null : { ch, fg, bg });
	}
	setCellWithAlphaBlending(x: number, y: number, ch: string, fg: C): void {
		this.put(x, y, ch === ' ' ? null : { ch, fg, bg: null });
	}
	at(cx: number, cy: number): PlainFrameCell<C> | null {
		if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) return null;
		return this.cells[cy * this.width + cx];
	}
}

export function renderPlainFrame<C>(
	doc: SpriteDoc,
	frameLabel: string | undefined,
	style: RenderStyle<C>,
): PlainFrame<C> | null {
	let base: Sprite;
	try {
		base = spriteFromDoc(doc, frameLabel);
	} catch {
		return null;
	}
	const baseline = spriteMetaFor(PLAIN_TYPE).baseline;
	const e: Entity = { ...baseAvatar(1), type: PLAIN_TYPE };
	e.cosmetics = undefined;

	const cam = {
		x: -Math.floor((base.w - BOX.w) / 2),
		y: BOX.h - base.h + baseline,
	};
	const buf = new PlainCapture<C>(base.w, base.h);
	drawEntitySprite(buf, e, cam, style, undefined, undefined, { base });
	return { w: base.w, h: base.h, at: (cx, cy) => buf.at(cx, cy) };
}

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
