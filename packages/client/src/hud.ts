// HUD chrome (ADR 0005, step 2): the stats bar, controls hint, and recent log,
// lifted out of the playfield into layout-driven renderables. They overlay the
// full-screen playfield via absolute positioning + a higher zIndex, so the play
// area keeps its full viewport while Yoga handles placement — no more manual
// buf.drawText / setCell math. State-driven content is pushed in via update().
import type { GameState } from '@mmo/shared';
import { activeZone } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

const HINT = 'move ←/→ a/d  jump ␣/↑  attack j/x  quit q';
const Z = 10; // draw above the playfield (zIndex 0)

export class Hud {
	private readonly topBar: BoxRenderable;
	private readonly bottom: BoxRenderable;
	private readonly stats: TextRenderable;
	private readonly meta: TextRenderable;
	private readonly log: TextRenderable;

	constructor(ctx: RenderContext) {
		// Top stats bar: full-width opaque strip, stats left / meta right.
		this.topBar = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			height: 1,
			flexDirection: 'row',
			justifyContent: 'space-between',
			backgroundColor: COLORS.hudBg,
			shouldFill: true,
			zIndex: Z,
		});
		this.stats = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		this.meta = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		this.topBar.add(this.stats);
		this.topBar.add(this.meta);

		// Bottom-left overlay: controls hint above the recent log.
		this.bottom = new BoxRenderable(ctx, {
			position: 'absolute',
			bottom: 0,
			left: 1,
			flexDirection: 'column',
			zIndex: Z,
		});
		this.bottom.add(
			new TextRenderable(ctx, { content: HINT, fg: COLORS.dim, bg: COLORS.bg }),
		);
		this.log = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.bg,
		});
		this.bottom.add(this.log);
	}

	/** Add the HUD overlays to a parent (typically renderer.root). */
	attach(parent: Renderable): void {
		parent.add(this.topBar);
		parent.add(this.bottom);
	}

	/** Refresh the readouts from the latest simulation state. */
	update(game: GameState, fps: number): void {
		const { player } = game;
		const p = player.avatar;
		const zone = activeZone(game.world, player.zoneId);
		const hpPct = Math.max(0, Math.round((p.hp / p.maxHp) * 100));
		this.stats.content = ` L${player.progress.level}  HP ${Math.max(0, Math.round(p.hp))}/${p.maxHp} (${hpPct}%)  XP ${player.progress.xp}  Gold ${player.progress.gold}  Items ${player.inventory.length} `;
		this.meta.content = `FPS ${fps}  monsters ${zone.monsters.length} `;
		this.log.content = player.log.slice(-3).join('\n');
	}
}
