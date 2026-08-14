import type { Item } from '@mmo/core/entities';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from '../theme';

const RARITY_PAD = 9;

export interface BagView {
	inventory: Item[];
	offhand: number | null;
}

export class Bag {
	private readonly container: BoxRenderable;
	private readonly list: TextRenderable;
	selected = 0;

	constructor(ctx: RenderContext) {
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
			borderColor: COLORS.hud,
			title: ' Inventory ',
			titleColor: COLORS.hud,
			backgroundColor: COLORS.hudBg,
		});
		this.list = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: '↑/↓ select   ↵ equip/unequip   b/esc close',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
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

	count(view: BagView): number {
		return view.inventory.length;
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

	update(view: BagView): void {
		const count = this.count(view);
		if (this.selected > count - 1) this.selected = Math.max(0, count - 1);
		if (count === 0) {
			this.list.content = '\n(your bags are empty)\n';
			return;
		}
		const rows = view.inventory.map((it, i) => {
			const caret = i === this.selected ? '▸' : ' ';
			const rarity = it.rarity.padEnd(RARITY_PAD);
			const equipped =
				it.slot === 'offhand' && view.offhand !== null ? '  (equipped)' : '';
			return `${caret} ${rarity} ${it.base}${equipped}`;
		});
		this.list.content = `\n${rows.join('\n')}\n`;
	}
}
