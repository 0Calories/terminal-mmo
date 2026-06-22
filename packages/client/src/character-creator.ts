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
	drawEntitySprite,
	maxHpForLevel,
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

// The preview canvas. Wide enough for the Sprite (9) and a short handle; tall enough
// for the nameplate + a 3-row hat above the 3-row Sprite.
const PREVIEW_W = 22;
const PREVIEW_H = 9;

// A still Avatar to draw in the preview: feet near the canvas bottom, centred, facing
// right, full health (no hurt flash), carrying the in-progress cosmetics + handle so
// the nameplate colour previews too. Positions chosen so drawEntitySprite lands the
// Sprite centred with room above for the hat + nameplate.
function previewAvatar(cosmetics: Cosmetics, name: string): Entity {
	return {
		id: 1,
		type: 'player',
		name,
		cosmetics,
		x: Math.round((PREVIEW_W - 9) / 2) + 2, // centre the 9-wide Sprite over the box
		y: PREVIEW_H - BOX.h + 1,
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

// A live node that imperatively blits the preview Avatar through the shared renderer.
// `live` so it redraws every frame; its `avatar` is swapped on each picker change.
class PreviewRenderable extends Renderable {
	avatar: Entity = previewAvatar({ hue: 0, hat: 0, nameplate: 0 }, '');

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		super(ctx, { live: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		buffer.clear(COLORS.hudBg);
		drawEntitySprite(buffer, this.avatar, { x: 0, y: 0 }, STYLE);
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
