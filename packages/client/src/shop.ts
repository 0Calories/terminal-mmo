// View + selection state only; the transaction and Gold/inventory mutation live
// in index.ts, which owns game state.
import type { GameState } from '@mmo/shared';
import { saleValue } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

const RARITY_PAD = 9; // width of 'legendary', the widest rarity word

export class Shop {
	private readonly container: BoxRenderable;
	private readonly gold: TextRenderable;
	private readonly list: TextRenderable;
	selected = 0;

	constructor(ctx: RenderContext) {
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

		const panel = new BoxRenderable(ctx, {
			flexDirection: 'column',
			width: 46,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.vendor,
			title: ' Merchant — sell loot ',
			titleColor: COLORS.vendor,
			backgroundColor: COLORS.hudBg,
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
			content: '↑/↓ select   ↵ sell   e/esc close',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		panel.add(this.gold);
		panel.add(this.list);
		panel.add(footer);
		this.container.add(panel);
	}

	attach(parent: Renderable): void {
		parent.add(this.container);
	}

	get open(): boolean {
		return this.container.visible;
	}

	show(): void {
		this.selected = 0;
		this.container.visible = true;
	}

	hide(): void {
		this.container.visible = false;
	}

	move(delta: number, count: number): void {
		if (count <= 0) {
			this.selected = 0;
			return;
		}
		this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
	}

	update(player: GameState['player']): void {
		const inv = player.inventory;
		if (this.selected > inv.length - 1)
			this.selected = Math.max(0, inv.length - 1);
		this.gold.content = `Gold ${player.progress.gold}`;
		if (inv.length === 0) {
			this.list.content = '\n(your bags are empty)\n';
			return;
		}
		const rows = inv.map((it, i) => {
			const caret = i === this.selected ? '▸' : ' ';
			const rarity = it.rarity.padEnd(RARITY_PAD);
			return `${caret} ${rarity} ${it.base}  +${saleValue(it)}g`;
		});
		this.list.content = `\n${rows.join('\n')}\n`;
	}
}
