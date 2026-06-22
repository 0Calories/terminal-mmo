// The pre-spawn character-customization screen (#36, PRD story 7; ADR 0005). Shown
// once at launch before the networked connect: the Player cycles body hue / hat /
// nameplate colour and watches a live Avatar Sprite preview, then confirms to enter
// the World with that look (it rides the connect handshake, #35).
//
// This is the RETAINED-UI shell (Yoga-laid-out box + text, no hand-painted x/y) plus
// one small imperative preview node — the same imperative-inside-renderSelf seam the
// playfield uses (ADR 0005). The picker LOGIC is the pure, tested customize.ts; this
// file is rendering only and is validated by eye (rendering isn't unit-tested, PRD).
import type { Cosmetics, Entity, RenderStyle } from '@mmo/shared';
import {
	BOX,
	buildSceneStyle,
	HATS,
	maxHpForLevel,
	renderZoneScene,
	spriteFor,
} from '@mmo/shared';
import {
	BoxRenderable,
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type Renderable as RenderableType,
	type RenderContext,
	RGBA,
	TextRenderable,
} from '@opentui/core';
import {
	type CustomizeState,
	customizeRows,
	initCustomize,
	reduceCustomize,
} from './customize';
import { COLORS } from './theme';

// Same colour binding the playfield uses, so the preview Avatar renders identically
// to how it ships in-world (one shared source, can't drift — #56).
const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// Preview geometry, derived from the real Sprite / hat catalog so it always frames
// the whole Avatar. Top to bottom the drawn stack is hat (0–MAX_HAT_H rows) + Sprite
// + boxed nameplate (NAMEPLATE_H rows, below the feet — #103), with a row of padding
// above and below; the canvas is sized for the tallest possible stack so no selection
// ever clips.
export const PLAYER = spriteFor('player');
// The boxed nameplate is 3 rows: top border, handle, bottom border (#103).
export const NAMEPLATE_H = 3;
const MAX_HAT_H = Math.max(0, ...HATS.map((h) => h.sprite?.h ?? 0));
export const VPAD = 1;
const PREVIEW_W = PLAYER.w + 12; // Sprite plus room for a short handle either side
export const PREVIEW_H = MAX_HAT_H + PLAYER.h + NAMEPLATE_H + 2 * VPAD;

// A still Avatar for the preview: facing right, full health (no hurt flash), carrying
// the in-progress cosmetics + handle so the body hue, hat, AND nameplate colour all
// preview. The Sprite is ANCHORED at a fixed vertical position — VPAD plus reserved
// headroom for the tallest possible hat — so cycling hats only moves the headwear
// above the head, never the body/feet (#104). Room is reserved below for the boxed
// nameplate (#103). x/y are the inverse of drawEntitySprite's placement, so the
// resolved Sprite lands where intended.
export function previewAvatar(cosmetics: Cosmetics, name: string): Entity {
	const spriteTop = VPAD + MAX_HAT_H;
	const spriteLeft = Math.round((PREVIEW_W - PLAYER.w) / 2);
	return {
		id: 1,
		type: 'player',
		name,
		cosmetics,
		x: spriteLeft + Math.floor((PLAYER.w - BOX.w) / 2),
		y: spriteTop - (BOX.h - PLAYER.h),
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: maxHpForLevel(1),
		maxHp: maxHpForLevel(1),
		hurtT: 0,
		attackT: 0,
	};
}

// A live node that draws the preview Avatar through the shared renderer's full path
// (renderZoneScene -> Sprite + hat + nameplate), so the preview is exactly what ships
// in-world. `live` so it redraws every frame; `avatar` is swapped on each picker change.
class PreviewRenderable extends Renderable {
	avatar: Entity = previewAvatar({ hue: 0, hat: 0, nameplate: 0 }, '');

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		// `buffered` gives this node its OWN frame buffer: renderSelf draws into it at
		// local 0,0 and opentui composites it at the node's laid-out position inside the
		// panel. Without it, renderSelf would draw onto the root buffer at absolute 0,0
		// (top-left of the screen) and renderZoneScene's clear would wipe everything.
		super(ctx, { live: true, buffered: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		const terrain = {
			w: buffer.width,
			h: buffer.height,
			cells: new Uint8Array(buffer.width * buffer.height),
		};
		renderZoneScene(
			buffer,
			{ terrain, portals: [], npcs: [], entities: [this.avatar] },
			{ x: 0, y: 0 },
			STYLE,
		);
	}
}

// The customization screen. Mirrors the Shop's structure (a full-screen container +
// a centred bordered panel) and key-routing contract: index.ts feeds keys to `key()`,
// which returns the chosen Cosmetics on Enter (and otherwise null), refreshing the
// preview + rows itself.
export class CharacterCreator {
	private readonly container: BoxRenderable;
	private readonly preview: PreviewRenderable;
	private readonly rows: TextRenderable;
	private state: CustomizeState;
	private readonly handle: string;

	constructor(ctx: RenderContext, handle: string, start: Cosmetics) {
		this.handle = handle;
		this.state = initCustomize(start);

		this.container = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 30, // above HUD (z10) and Shop (z20)
			visible: false,
		});

		const panel = new BoxRenderable(ctx, {
			flexDirection: 'column',
			alignItems: 'center',
			width: 40,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.vendor,
			title: ' Create your Avatar ',
			titleColor: COLORS.vendor,
			backgroundColor: COLORS.hudBg,
		});

		this.preview = new PreviewRenderable(ctx, {
			width: PREVIEW_W,
			height: PREVIEW_H,
		});
		this.rows = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: '↑/↓ field   ←/→ change   ↵ enter the World',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});

		panel.add(this.preview);
		panel.add(this.rows);
		panel.add(footer);
		this.container.add(panel);
		this.refresh();
	}

	attach(parent: RenderableType): void {
		parent.add(this.container);
	}

	get open(): boolean {
		return this.container.visible;
	}

	show(): void {
		this.container.visible = true;
	}

	hide(): void {
		this.container.visible = false;
	}

	// Feed one key. Returns the confirmed Cosmetics on Enter, else null. Refreshes the
	// preview + field rows after every change so the screen tracks the selection live.
	key(name: string): Cosmetics | null {
		const { state, confirm } = reduceCustomize(this.state, name);
		this.state = state;
		this.refresh();
		return confirm ? state.cosmetics : null;
	}

	private refresh(): void {
		this.preview.avatar = previewAvatar(this.state.cosmetics, this.handle);
		const lines = customizeRows(this.state).map((r) => {
			const caret = r.focused ? '▸' : ' ';
			return `${caret} ${r.label.padEnd(10)} ◂ ${r.value} ▸`;
		});
		this.rows.content = `\n${lines.join('\n')}\n`;
	}
}
