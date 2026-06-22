import type { Entity, GameState } from '@mmo/shared';
import {
	aabbOverlap,
	activeZone,
	BOX,
	buildSceneStyle,
	COMBAT,
	drawEntitySprite,
	emoteById,
	entityBox,
	meleeHitbox,
	type RenderStyle,
	renderZoneScene,
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
import { COLORS as C } from './theme';

// The colour binding for the shared, framework-agnostic renderer (@mmo/shared):
// resolved from the shared scene colour DATA so the game and the zone-tools
// preview render from one source and can't drift (#56).
const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// The shared over-head box behind both the chat Speech bubble (#59, ADR 0007) and
// the emote (#38): a bordered, opaque box with a downward tail, anchored above the
// nameplate and re-projected through the camera each frame so it tracks the moving
// Avatar. x-clamped to the viewport so it can't clip off-screen. The two callers
// differ only in their CONTENT (`lines`) and `style` colours — the geometry is one
// place so they can't drift.
interface BoxStyle {
	fg: RGBA;
	border: RGBA;
	bg: RGBA;
}

function drawOverheadBox(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
	lines: readonly string[],
	style: BoxStyle,
) {
	const sprite = spriteFor(e.type);
	const top = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const innerW = Math.max(1, ...lines.map((l) => l.length));
	const boxW = innerW + 2;
	const boxH = lines.length + 2;

	const cx = e.x + BOX.w / 2 - cam.x;
	// Tail tip sits one row above the nameplate (which is at top - 1); the box bottom
	// border is just above the tail.
	const tailY = top - 2;
	const tailX = Math.round(cx);
	const topY = tailY - boxH;
	let left = Math.round(cx - boxW / 2);
	left = Math.max(0, Math.min(left, sw - boxW)); // keep the whole box on screen

	for (let ry = 0; ry < boxH; ry++) {
		const py = topY + ry;
		if (py < 0 || py >= sh) continue;
		const lastRow = ry === boxH - 1;
		for (let rx = 0; rx < boxW; rx++) {
			const px = left + rx;
			if (px < 0 || px >= sw) continue;
			const lastCol = rx === boxW - 1;
			let ch = ' ';
			let fg = style.fg;
			if (ry === 0 || lastRow || rx === 0 || lastCol) {
				fg = style.border;
				if (ry === 0) ch = rx === 0 ? '╭' : lastCol ? '╮' : '─';
				else if (lastRow) ch = rx === 0 ? '╰' : lastCol ? '╯' : '─';
				else ch = '│';
			} else {
				ch = lines[ry - 1]?.[rx - 1] ?? ' ';
			}
			buf.setCell(px, py, ch, fg, style.bg);
		}
	}
	if (tailY >= 0 && tailY < sh && tailX >= 0 && tailX < sw)
		buf.setCell(tailX, tailY, '▼', style.border, style.bg);
}

const BUBBLE_STYLE: BoxStyle = {
	fg: C.bubbleFg,
	border: C.bubbleBorder,
	bg: C.bubbleBg,
};
// Emotes reuse the bubble's opaque panel but in the high-contrast emote colour so a
// reaction reads distinctly from a chat line (#38).
const EMOTE_STYLE: BoxStyle = {
	fg: C.emote,
	border: C.emote,
	bg: C.bubbleBg,
};

// The latest Chat line, word-wrapped, in the shared over-head box (#59, ADR 0007).
function drawSpeechBubble(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!e.bubble) return;
	drawOverheadBox(buf, e, cam, sw, sh, layoutBubble(e.bubble), BUBBLE_STYLE);
}

// Pad every line to a common width, centred — so a ragged ASCII-art image sits
// centred in the box (chat text stays left-aligned and skips this).
function centerLines(lines: readonly string[]): string[] {
	const w = Math.max(...lines.map((l) => l.length));
	return lines.map((l) => {
		const pad = w - l.length;
		const lpad = Math.floor(pad / 2);
		return ' '.repeat(lpad) + l + ' '.repeat(pad - lpad);
	});
}

// A transient emote (#38): the emote id resolved to its sized-up multi-row ASCII
// art, drawn in the SAME over-head box as a Speech bubble (one shared renderer) on
// the telegraph layer (above all Sprites, ADR 0003), self-clearing upstream.
function drawEmote(
	buf: OptimizedBuffer,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!e.emote) return;
	const def = emoteById(e.emote);
	if (!def) return;
	drawOverheadBox(buf, e, cam, sw, sh, centerLines(def.art), EMOTE_STYLE);
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

function drawPlayfield(
	buf: OptimizedBuffer,
	game: GameState,
	cam: { x: number; y: number },
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
	// Avatars + nameplates) via the shared renderer — the same path zone-tools
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

	// Final pass after all Sprites + nameplates: over-head Speech bubbles for every
	// chatter on screen, the local Avatar included (one uniform rule, ADR 0007). An
	// absent sender simply has no entity here, so its bubble isn't drawn.
	for (const e of others) drawSpeechBubble(buf, e, cam, sw, sh);
	drawSpeechBubble(buf, p, cam, sw, sh);

	// Over-head emotes for every emoting Avatar on screen, the local one included —
	// one uniform rule (#38, ADR 0003), on top of all Sprites and nameplates.
	for (const e of others) drawEmote(buf, e, cam, sw, sh);
	drawEmote(buf, p, cam, sw, sh);

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

	private camState: CameraState = initCameraState();

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
		if (this.camState.cam) drawPlayfield(buffer, this.game, this.camState.cam);
	}
}
