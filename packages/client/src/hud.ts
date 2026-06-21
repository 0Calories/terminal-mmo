// HUD chrome (ADR 0005, step 2): stats bar, controls hint, and recent log as
// layout-driven renderables that overlay the full-screen playfield via absolute
// positioning + a higher zIndex. State-driven content is pushed in via update().
import type { GameState } from '@mmo/shared';
import { activeZone, skillForSlot, skillUnlocked } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

const HINT = 'move ←/→ a/d  jump ␣/↑  attack j/x  skill k  interact e  quit q';
const Z = 10; // draw above the playfield (zIndex 0)

/** One-line Skill status: per bound slot, the key, name, and whether it's locked
 * (below its unlock level), on cooldown (seconds left), or ready. */
function skillReadout(player: GameState['player']): string {
	const segs: string[] = [];
	for (let slot = 1; ; slot++) {
		const skill = skillForSlot(player.class ?? 'warrior', slot);
		if (!skill) break;
		let state: string;
		if (!skillUnlocked(skill, player.progress.level))
			state = `L${skill.unlockLevel}`;
		else {
			const cd = player.skillCooldowns?.[skill.id] ?? 0;
			state = cd > 0 ? `${cd.toFixed(1)}s` : 'ready';
		}
		segs.push(`k ${skill.name}: ${state}`);
	}
	return segs.join('   ');
}

export class Hud {
	private readonly topBar: BoxRenderable;
	private readonly bottom: BoxRenderable;
	private readonly stats: TextRenderable;
	private readonly meta: TextRenderable;
	private readonly skills: TextRenderable;
	private readonly log: TextRenderable;

	constructor(ctx: RenderContext) {
		// Full-width opaque strip, stats left / meta right.
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
		// Skill cooldown readout (story 22): one line, sits above the log.
		this.skills = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.melee,
			bg: COLORS.bg,
		});
		this.bottom.add(this.skills);
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
		this.skills.content = skillReadout(player);
		this.log.content = player.log.slice(-3).join('\n');
	}
}
