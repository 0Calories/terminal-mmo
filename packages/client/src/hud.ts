import type { GameState } from '@mmo/shared';
import { activeZone, skillForSlot, skillUnlocked } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

const HINT =
	'move ←/→ a/d  jump ␣/↑  attack j/x  skill k  interact e  chat ⏎ (/w whisper)  quit q';
const Z = 10; // above the playfield (zIndex 0)
const CHAT_LINES = 4; // recent Zone-chat lines shown above the input

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
	private readonly alpha: TextRenderable;
	private readonly meta: TextRenderable;
	private readonly skills: TextRenderable;
	private readonly log: TextRenderable;
	private readonly chat: TextRenderable;
	private readonly chatInput: TextRenderable;

	constructor(ctx: RenderContext) {
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
		// Centre of the top bar: an alpha warning, shown only in networked play
		// (ADR 0009 — the live World is ephemeral). Empty until showAlphaNotice().
		this.alpha = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.vendor,
			bg: COLORS.hudBg,
		});
		this.meta = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		this.topBar.add(this.stats);
		this.topBar.add(this.alpha);
		this.topBar.add(this.meta);

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
		// Zone-local chat (#34): received lines, then the active typing line below.
		this.chat = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.chat,
			bg: COLORS.bg,
		});
		this.bottom.add(this.chat);
		this.chatInput = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.melee,
			bg: COLORS.bg,
		});
		this.bottom.add(this.chatInput);
	}

	attach(parent: Renderable): void {
		parent.add(this.topBar);
		parent.add(this.bottom);
	}

	// Surface the ephemeral-alpha warning in the top bar (ADR 0009). Called once on
	// entering networked play; the offline loop leaves it blank.
	showAlphaNotice(): void {
		this.alpha.content = ' ⚠ ALPHA · progress resets when the server restarts ';
	}

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

	// Render the Zone-chat log and, while typing, the active input line with a
	// cursor. `lines` are pre-formatted "handle: text"; `draft` is the in-progress
	// message. Driven each frame from NetClient.chatLog + the ChatInput state.
	updateChat(lines: string[], open: boolean, draft: string): void {
		this.chat.content = lines.slice(-CHAT_LINES).join('\n');
		this.chatInput.content = open ? `say> ${draft}█` : '';
	}
}
