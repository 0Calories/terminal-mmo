import type { GameState } from '@mmo/shared';
import { STARTER_GOODS, saleValue } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from '../theme';

const RARITY_PAD = 9; // width of 'legendary', the widest rarity word
const SLOT_PAD = 9; // width of 'accessory', the widest Slot word

export type ShopMode = 'sell' | 'buy';

export type ShopView = Pick<GameState['player'], 'inventory' | 'progress'>;

export class Shop {
	private readonly container: BoxRenderable;
	private readonly panel: BoxRenderable;
	private readonly tabs: TextRenderable;
	private readonly gold: TextRenderable;
	private readonly list: TextRenderable;
	selected = 0;
	mode: ShopMode = 'sell';
	private readonly sellOnly: boolean;

	constructor(ctx: RenderContext, sellOnly = false) {
		this.sellOnly = sellOnly;
		// zIndex 20 puts it above the HUD (z10).
		this.container = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 20,
			visible: false,
		});

		this.panel = new BoxRenderable(ctx, {
			flexDirection: 'column',
			width: 46,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.vendor,
			title: ' Merchant ',
			titleColor: COLORS.vendor,
			backgroundColor: COLORS.hudBg,
		});
		this.tabs = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.vendor,
			bg: COLORS.hudBg,
		});
		this.gold = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.vendor,
			bg: COLORS.hudBg,
		});
		this.list = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: sellOnly
				? '↑/↓ select   ↵ sell   e/esc close'
				: '←/→ tab   ↑/↓ select   ↵ trade   e/esc close',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		this.panel.add(this.tabs);
		this.panel.add(this.gold);
		this.panel.add(this.list);
		this.panel.add(footer);
		this.container.add(this.panel);
	}

	attach(parent: Renderable): void {
		parent.add(this.container);
	}

	get open(): boolean {
		return this.container.visible;
	}

	count(player: ShopView): number {
		return this.mode === 'buy' ? STARTER_GOODS.length : player.inventory.length;
	}

	show(): void {
		this.selected = 0;
		this.mode = 'sell';
		this.container.visible = true;
	}

	hide(): void {
		this.container.visible = false;
	}

	switchTab(): void {
		if (this.sellOnly) return;
		this.mode = this.mode === 'sell' ? 'buy' : 'sell';
		this.selected = 0;
	}

	move(delta: number, count: number): void {
		if (count <= 0) {
			this.selected = 0;
			return;
		}
		this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
	}

	update(player: ShopView): void {
		const count = this.count(player);
		if (this.selected > count - 1) this.selected = Math.max(0, count - 1);
		this.tabs.content = this.sellOnly
			? ''
			: this.mode === 'sell'
				? '[ Sell ]  Buy'
				: '  Sell  [ Buy ]';
		this.gold.content = `Gold ${player.progress.gold}`;
		this.panel.title =
			this.mode === 'sell'
				? ' Merchant — sell loot '
				: ' Merchant — buy goods ';
		this.list.content =
			this.mode === 'sell' ? this.sellRows(player) : this.buyRows();
	}

	private sellRows(player: ShopView): string {
		const inv = player.inventory;
		if (inv.length === 0) return '\n(your bags are empty)\n';
		const rows = inv.map((it, i) => {
			const caret = i === this.selected ? '▸' : ' ';
			const rarity = it.rarity.padEnd(RARITY_PAD);
			return `${caret} ${rarity} ${it.base}  +${saleValue(it)}g`;
		});
		return `\n${rows.join('\n')}\n`;
	}

	private buyRows(): string {
		const rows = STARTER_GOODS.map((g, i) => {
			const caret = i === this.selected ? '▸' : ' ';
			const slot = g.slot.padEnd(SLOT_PAD);
			return `${caret} ${slot} ${g.base}  −${g.price}g`;
		});
		return `\n${rows.join('\n')}\n`;
	}
}
