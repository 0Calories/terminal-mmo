// The controls overlay (#242, ADR 0024 — "learn controls (?)" is a beat of the demo
// arc). A toggleable, read-only cheat-sheet of every input, in the Shop/AudioOptions
// mold: an absolute, centered panel on the modal layer. Level-gated verbs (the #233
// capability ladder) show WHEN they unlock, so a fresh Player reads the overlay and
// knows both the key and whether it's earned yet. The row data is pure and exported so
// a test can assert every input is covered.

import type { Capability } from '@mmo/shared';
import { CAPABILITY_UNLOCK, capabilityUnlocked } from '@mmo/shared';
import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import type { Scheme } from './input';
import { COLORS } from './theme';

export interface ControlRow {
	label: string;
	// The binding(s) in the default keyboard scheme (input.ts KEYBOARD_BINDINGS).
	keys: string;
	// The binding(s) under the keyboard+mouse scheme (MOUSE_BINDINGS), for the rows that
	// move — attack/skills/interact/block. Absent when the scheme doesn't change the key.
	mouseKeys?: string;
	// The capability a level-gated verb sits behind (#233); drives the "unlocks at L?"
	// note. Absent for inputs available from the start.
	capability?: Capability;
}

// Every input the client understands, grouped move → combat → social → system. Kept in
// lockstep with the two binding tables in input.ts and the emote set in chat.ts.
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
	{ label: 'Audio', keys: 'o' },
	{ label: 'Mute', keys: 'm' },
	{ label: 'Controls', keys: '?' },
	{ label: 'Quit', keys: 'q' },
];

const LABEL_PAD = Math.max(...CONTROL_ROWS.map((r) => r.label.length));

// The binding shown for a row under the active scheme — the mouse override when the
// keyboard+mouse scheme is running and this row moves, else the keyboard binding.
export function keysFor(row: ControlRow, scheme: Scheme): string {
	return scheme === 'mouse' && row.mouseKeys ? row.mouseKeys : row.keys;
}

// One rendered line: label, the active scheme's binding, and — for a still-locked verb —
// when it unlocks.
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
		// zIndex 20: above the HUD (z10), same layer as the Shop / AudioOptions modals.
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

	// Render against the Player's current level (locked verbs note when they unlock) and
	// the active control scheme (so the keys shown are the ones that actually act), then
	// reveal the overlay.
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
