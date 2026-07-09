import {
	ACTION_FLAG,
	type AttackPhase,
	BOX,
	bladeEdgeArc,
	bodyFrame,
	type Entity,
	type Facing,
	isSolid,
	type MoveId,
	mirrorAnchorX,
	type Npc,
	type Portal,
	spriteMetaFor,
	sweepIndex,
	swingPhase,
	swingProgress,
	type Terrain,
	weaponFrame,
} from '@mmo/core';
import { formById, formFrame } from './body-sprite';
import { HATS } from './hats';
import { spriteFor, spriteForNpc } from './registry';
import type { Sprite } from './sprite';
import { weaponSpriteById } from './weapon-registry';
import { WEAPON_ACCENT_KEY, type WeaponSprite } from './weapon-sprite';

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

export interface RenderStyle<C> {
	bg: C;
	terrainFg: C;
	terrainBg: C;
	portal: C;
	transparent: C;
	hurt: C;
	nameplate: C;
	nameplateBg: C;
	palette: Readonly<Record<string, C>>;
	paletteDefault: C;
	cosmetics: {
		hues: readonly C[];
		nameplates: readonly C[];
		nameplateBgs: readonly C[];
	};
}

export interface ZoneScene {
	terrain: Terrain;
	portals: readonly Portal[];
	npcs: readonly Npc[];
	entities: readonly Entity[];
}

export interface GhostStyle<C> {
	bg: C;
	fade: (fg: C) => C;
}

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
				// Opaque (not blended) so it doesn't composite over the hidden terrainBg.
				buf.setCell(px, py, ch, fg, style.terrainFg);
			else buf.setCellWithAlphaBlending(px, py, ch, fg, style.transparent);
		}
	}
}

function baselineFor(e: Entity): number {
	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	return body ? (body.baseline ?? 0) : spriteMetaFor(e.type).baseline;
}

function hatFor(e: Entity): Sprite | null {
	return e.cosmetics ? (HATS[e.cosmetics.hat]?.sprite ?? null) : null;
}

function weaponSpriteFor(e: Entity): WeaponSprite | null {
	if (e.weapon === undefined) return null;
	return weaponSpriteById(e.weapon) ?? null;
}

function recolorFor<C>(
	e: Entity,
	style: RenderStyle<C>,
): Readonly<Record<string, C>> | undefined {
	const hue = e.cosmetics && style.cosmetics.hues[e.cosmetics.hue];
	return hue !== undefined ? { p: hue } : undefined;
}

export function drawEntitySprite<C>(
	buf: CellBuffer<C>,
	e: Entity,
	cam: { x: number; y: number },
	style: RenderStyle<C>,
	terrain?: Terrain,
	ghost?: GhostStyle<C>,
): void {
	let move: MoveId;
	let phase: AttackPhase | null;
	let progress: number;
	let staggered: boolean;
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

	const body = e.type === 'player' ? formById(e.cosmetics?.form) : null;
	let sprite: Sprite;
	let baseline: number;
	let grip: { x: number; y: number } | undefined;
	let head: { x: number; y: number } | undefined;
	if (body) {
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
		baseline = body.baseline ?? 0;
		grip = body.grip;
		head = body.head;
	} else {
		sprite = spriteFor(e.type);
		baseline = spriteMetaFor(e.type).baseline;
		grip = sprite.grip;
	}

	const sx = Math.round(e.x - Math.floor((sprite.w - BOX.w) / 2) - cam.x);
	const sy = Math.round(e.y + BOX.h - sprite.h + baseline - cam.y);
	const hurt = e.hurtT > 0.3;
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

	const ws = weaponSpriteFor(e);
	if (ws && grip) {
		const id = weaponFrame(move, phase);
		const frame =
			id === 'active'
				? ws.frames.active?.[sweepIndex(progress, ws.frames.active.length)]
				: ws.frames[id];
		const bodyGripX = sx + mirrorAnchorX(grip.x, sprite.w, e.facing);
		const bodyGripY = sy + grip.y;
		const accent = style.palette[ws.accent] ?? style.paletteDefault;
		if (frame) {
			const wgx = e.facing === 1 ? ws.grip.x : frame.w - 1 - ws.grip.x;
			blitSprite(
				buf,
				frame,
				bodyGripX - wgx,
				bodyGripY - ws.grip.y,
				e.facing,
				hurt,
				style,
				{ [WEAPON_ACCENT_KEY]: accent },
				ghost,
				plant,
			);
		}
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
				// Surface cell's top half is sky: use scene bg, not terrainBg, or an edge band appears.
				const surface = !isSolid(terrain, wx, wy - 1);
				if (surface) buf.setCell(sx, sy, '▄', style.terrainFg, style.bg);
				else buf.setCell(sx, sy, '█', style.terrainFg, style.terrainBg);
			}
		}
	}

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

	for (const n of scene.npcs) drawNpcSprite(buf, n, cam, style);

	// y-sorted so avatars and monsters occlude each other correctly.
	const sprites = [...scene.entities].sort((a, b) => a.y - b.y);
	for (const e of sprites) drawEntitySprite(buf, e, cam, style, terrain);
}
