// Retained-UI shell for the audio options modal (ADR 0014/0015, #150). Holds only
// selection state; mixer state is the SoundSystem's, so adjustments call through its
// setters (which clamp and persist via onChange). Pure row/key logic is in audio-options.ts.

import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import {
	AUDIO_ROWS,
	audioKeyAction,
	audioOptionsRows,
	clampSelection,
} from './audio-options';
import type { SoundSystem } from './sound/system';
import { COLORS } from './theme';

export class AudioOptions {
	private readonly container: BoxRenderable;
	private readonly rows: TextRenderable;
	private readonly status: TextRenderable;
	private selected = 0;

	constructor(
		ctx: RenderContext,
		private readonly sound: SoundSystem,
	) {
		// zIndex 20: above the HUD (z10), same layer as the Shop modal.
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
			title: ' Audio options ',
			titleColor: COLORS.hud,
			backgroundColor: COLORS.hudBg,
		});
		this.rows = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		this.status = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: '↑/↓ select   ←/→ adjust   m mute   o/esc close',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		panel.add(this.rows);
		panel.add(this.status);
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
		this.update();
	}

	hide(): void {
		this.container.visible = false;
	}

	// Adjustments and mute route through the live SoundSystem (persists via onChange);
	// selection is local.
	key(name: string): void {
		const action = audioKeyAction(name);
		switch (action.kind) {
			case 'move':
				this.selected = clampSelection(this.selected, action.delta);
				break;
			case 'adjust':
				this.adjust(action.delta);
				break;
			case 'toggleMute':
				this.sound.toggleMute();
				break;
			case 'close':
				this.hide();
				return;
		}
		this.update();
	}

	private adjust(delta: number): void {
		const row = AUDIO_ROWS[this.selected];
		if (row.key === 'master')
			this.sound.setMasterVolume(this.sound.masterVolume + delta);
		else
			this.sound.setBusVolume(row.key, this.sound.busVolume(row.key) + delta);
	}

	private update(): void {
		const widest = Math.max(...AUDIO_ROWS.map((r) => r.label.length));
		const rows = audioOptionsRows(this.sound.audioPrefs(), this.selected);
		this.rows.content = `\n${rows
			.map((r) => {
				const caret = r.focused ? '▸' : ' ';
				return `${caret} ${r.label.padEnd(widest)}  ${r.value}`;
			})
			.join('\n')}\n`;
		this.status.content = `Master mute: ${this.sound.muted ? 'ON (muted)' : 'off'}\n`;
	}
}
