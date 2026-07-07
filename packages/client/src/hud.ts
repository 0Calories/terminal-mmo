import type { GameState } from '@mmo/shared';
import {
	activeZone,
	filledCells,
	skillForSlot,
	skillUnlocked,
	xpProgress,
} from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	type RGBA,
	TextRenderable,
} from '@opentui/core';
import { MessageLog } from './message-log';
import { COLORS } from './theme';

// The level-up banner (#271): a brief "LEVEL UP!" flash centred over the playfield,
// shown for this long from the moment the Player's level ticks up, then cleared.
const BANNER_MS = 1000;
const BANNER_TEXT = '★  LEVEL UP!  ★';

const HINT =
	'move ←/→ a/d  jump ␣/↑  attack j/x  block k  dodge l  skills u/i  interact e  chat ⏎  ? controls  quit q';
const Z = 10; // above the playfield (zIndex 0)
const BAR_WIDTH = 10; // glyph cells per HUD vital bar
const BAR_FILL = '█';
const BAR_TRACK = '░';

// One labelled HUD vital bar (#243): a bright fill over a dim track plus a numeric
// readout — the shared shape for HP, EXP, and the future Stamina bar. Fill and track are
// two TextRenderables so the lit portion carries the vital's colour while the remainder
// stays a faint track. The fill-cell count is the shared, deterministic `filledCells`.
class Bar {
	readonly box: BoxRenderable;
	private readonly fill: TextRenderable;
	private readonly track: TextRenderable;
	private readonly value: TextRenderable;

	constructor(ctx: RenderContext, label: string, color: RGBA) {
		this.box = new BoxRenderable(ctx, {
			flexDirection: 'row',
			backgroundColor: COLORS.hudBg,
		});
		this.box.add(
			new TextRenderable(ctx, {
				content: `${label} `,
				fg: COLORS.dim,
				bg: COLORS.hudBg,
			}),
		);
		this.fill = new TextRenderable(ctx, {
			content: '',
			fg: color,
			bg: COLORS.hudBg,
		});
		this.track = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		this.value = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		this.box.add(this.fill);
		this.box.add(this.track);
		this.box.add(this.value);
	}

	// Paint the bar to `ratio` (0..1, clamped) and set its numeric readout.
	set(ratio: number, value: string): void {
		const lit = filledCells(ratio, BAR_WIDTH);
		this.fill.content = BAR_FILL.repeat(lit);
		this.track.content = BAR_TRACK.repeat(BAR_WIDTH - lit);
		this.value.content = ` ${value}  `;
	}
}

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
		segs.push(`${skill.key} ${skill.name}: ${state}`);
	}
	return segs.join('   ');
}

export class Hud {
	private readonly topBar: BoxRenderable;
	private readonly bottom: BoxRenderable;
	private readonly level: TextRenderable;
	private readonly hpBar: Bar;
	private readonly xpBar: Bar;
	private readonly wallet: TextRenderable;
	private readonly alpha: TextRenderable;
	private readonly meta: TextRenderable;
	private readonly skills: TextRenderable;
	// The bottom-left message log + chat (#272): a ScrollBox display and a chat input,
	// replacing the old unbounded log/chat TextRenderables.
	private readonly messages: MessageLog;
	// The level-up banner (#271): a centred flash. Empty until flashLevelUp() arms it;
	// `bannerUntil` is the wall-clock time (performance.now scale) it clears at.
	private readonly banner: BoxRenderable;
	private readonly bannerText: TextRenderable;
	private bannerUntil = 0;

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
		// Left of the top bar: the Avatar's vitals as bars — level, an HP bar, an XP bar,
		// then the Gold/Items wallet. A future Stamina bar (stretch goal, ADR 0024
		// amendment) slots in right after the HP bar, reusing the same `Bar` shape; the
		// row already leaves the room.
		const vitals = new BoxRenderable(ctx, {
			flexDirection: 'row',
			alignItems: 'center',
			backgroundColor: COLORS.hudBg,
		});
		this.level = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		this.hpBar = new Bar(ctx, 'HP', COLORS.hp);
		// ── Stamina bar slots in here: new Bar(ctx, 'SP', <its colour>) ──
		this.xpBar = new Bar(ctx, 'XP', COLORS.xp);
		this.wallet = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		vitals.add(this.level);
		vitals.add(this.hpBar.box);
		vitals.add(this.xpBar.box);
		vitals.add(this.wallet);
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
		this.topBar.add(vitals);
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
			fg: COLORS.telegraph,
			bg: COLORS.bg,
		});
		this.bottom.add(this.skills);
		// The message log + chat (#272): the scrolling display sits under the skills line;
		// its chat input is attached below when chat is enabled (via enableChat).
		this.messages = new MessageLog(ctx);
		this.bottom.add(this.messages.scrollBox);

		// The level-up banner (#271): an absolutely-positioned row a few cells below the
		// top bar, its text centred over the playfield. Kept empty (so it takes no visual
		// space) until a level-up arms it, then cleared after BANNER_MS.
		this.banner = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 2,
			left: 0,
			right: 0,
			height: 1,
			flexDirection: 'row',
			justifyContent: 'center',
			zIndex: Z,
		});
		this.bannerText = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.xp,
			bg: COLORS.hudBg,
		});
		this.banner.add(this.bannerText);
	}

	attach(parent: Renderable): void {
		parent.add(this.topBar);
		parent.add(this.bottom);
		parent.add(this.banner);
	}

	// Arm the level-up banner (#271): flashes BANNER_TEXT for BANNER_MS from now. Fired on
	// the rising edge of the Player's level, alongside the burst + sound. Idempotent —
	// re-arming just extends the window, so back-to-back level-ups read as one flash.
	flashLevelUp(): void {
		this.bannerUntil = performance.now() + BANNER_MS;
	}

	// Surface the ephemeral-alpha warning in the top bar (ADR 0009). Called once on
	// entering networked play.
	showAlphaNotice(): void {
		this.alpha.content = ' ⚠ ALPHA · progress resets when the server restarts ';
	}

	update(game: GameState, fps: number): void {
		const { player } = game;
		const p = player.avatar;
		const zone = activeZone(game.world, player.zoneId);
		const hp = Math.max(0, Math.round(p.hp));
		this.level.content = ` L${player.progress.level}  `;
		this.hpBar.set(p.hp / p.maxHp, `${hp}/${p.maxHp}`);
		const xp = xpProgress(player.progress.level, player.progress.xp);
		this.xpBar.set(xp.ratio, xp.atCap ? 'MAX' : `${xp.current}/${xp.needed}`);
		this.wallet.content = `Gold ${player.progress.gold}  Items ${player.inventory.length} `;
		this.meta.content = `FPS ${fps}  monsters ${zone.monsters.length} `;
		this.skills.content = skillReadout(player);
		// Append any new game-log lines (loot / vendor / travel / level-up unlocks) to the
		// scrolling message log; a loot pickup line is tinted by rarity (#272).
		this.messages.syncLog(player.log);
		// Hold the level-up banner while its window is live, then clear it (#271).
		this.bannerText.content =
			performance.now() < this.bannerUntil ? BANNER_TEXT : '';
	}

	// Enable the chat input (networked play, #272): attach it under the message log and
	// wire the submit callback the loop uses to parse + relay a sent line.
	enableChat(onSubmit: (text: string) => void): void {
		this.messages.onSubmit = onSubmit;
		this.bottom.add(this.messages.inputRow);
	}

	// Append any new Zone-chat lines (say / whisper / notice) to the message log. Driven
	// each frame from NetClient.chatLog (#272).
	syncChat(lines: string[]): void {
		this.messages.syncChat(lines);
	}

	// Whether the chat input owns the keyboard. The loop gates game input on this so
	// movement / combat / menu keys stay inert while typing (#272).
	get chatOpen(): boolean {
		return this.messages.chatOpen;
	}

	// Focus / blur the chat input (#272). Opening consumes the triggering key in the loop
	// so it isn't also delivered to the freshly-focused input.
	openChat(): void {
		this.messages.openChat();
	}

	closeChat(): void {
		this.messages.closeChat();
	}
}
