import type { Capability } from '@mmo/shared';
import { CAPABILITY_UNLOCK, capabilityUnlocked } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import type { Scheme } from '../input/movement';
import { COLORS } from '../theme';

export interface ControlRow {
	label: string;
	keys: string;
	mouseKeys?: string;
	capability?: Capability;
}

// Keep in lockstep with the binding tables in input.ts and the emotes in chat.ts.
export const CONTROL_ROWS: readonly ControlRow[] = [
	{ label: 'Move', keys: '←/→  ·  a/d' },
	{ label: 'Jump', keys: '␣  ·  ↑' },
	{
		label: 'Attack',
		keys: 'j  ·  x',
		mouseKeys: 'left-click',
		capability: 'attack',
	},
	{
		label: 'Block',
		keys: 'k',
		mouseKeys: 'k  ·  right-click',
		capability: 'block',
	},
	{ label: 'Dodge', keys: 'l', capability: 'dodge' },
	{
		label: 'Power Strike',
		keys: 'u',
		mouseKeys: 'e',
		capability: 'power-strike',
	},
	{
		label: 'Ground Pound',
		keys: 'i',
		mouseKeys: 'r',
		capability: 'ground-pound',
	},
	{ label: 'Interact', keys: 'e', mouseKeys: 'f' },
	{ label: 'Chat', keys: '↵   (/w whisper)' },
	{ label: 'Emote', keys: '/em wave · dance · sit' },
	{ label: 'Customize', keys: 'c   (in Town)' },
	{ label: 'Audio', keys: 'o' },
	{ label: 'Mute', keys: 'm' },
	{ label: 'Controls', keys: '?' },
	{ label: 'Quit', keys: 'q' },
];

const LABEL_PAD = Math.max(...CONTROL_ROWS.map((r) => r.label.length));

export function keysFor(row: ControlRow, scheme: Scheme): string {
	return scheme === 'mouse' && row.mouseKeys ? row.mouseKeys : row.keys;
}

export function controlRowText(
	row: ControlRow,
	level: number,
	scheme: Scheme,
): string {
	const gate =
		row.capability && !capabilityUnlocked(row.capability, level)
			? `  (unlocks at L${CAPABILITY_UNLOCK[row.capability]})`
			: '';
	return `${row.label.padEnd(LABEL_PAD)}  ${keysFor(row, scheme)}${gate}`;
}

export class Controls {
	private readonly container: BoxRenderable;
	private readonly rows: TextRenderable;

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
			width: 52,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.hud,
			title: ' Controls ',
			titleColor: COLORS.hud,
			backgroundColor: COLORS.hudBg,
		});
		this.rows = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: '?/esc close',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		panel.add(this.rows);
		panel.add(footer);
		this.container.add(panel);
	}

	attach(parent: Renderable): void {
		parent.add(this.container);
	}

	get open(): boolean {
		return this.container.visible;
	}

	show(level: number, scheme: Scheme): void {
		this.rows.content = `\n${CONTROL_ROWS.map((r) =>
			controlRowText(r, level, scheme),
		).join('\n')}\n`;
		this.container.visible = true;
	}

	hide(): void {
		this.container.visible = false;
	}
}
