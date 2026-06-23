// The Access Gate password prompt (TEMPORARY playtest lock). A locked deployed
// server (MMO_PASSWORD set) refuses the first hello with an `auth` reject; the
// client pops this modal, the player types the shared secret, and on Enter we
// retry hello on the same socket (NetClient.submitPassword). A wrong guess re-shows
// it with an error; the right one is dismissed when `welcome` arrives.
//
// Retained-UI shell in the audio-options / character-creator mold (an absolute,
// centred panel), with a small inline keystroke buffer in ChatInput's mold — the
// input is short-lived and single-purpose, so it lives in this one file to keep the
// gate a clean, deletable seam. Rendering is eyeball-only (not unit-tested, PRD);
// the input contract is exercised through chat.ts's shared ChatKey shape.
//
// To retire the gate, delete this file and its wiring in index.ts.

import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import type { ChatKey } from './chat';
import { COLORS } from './theme';

// What a fed key resolved to: submit a non-empty entry, quit the client (the gate is
// the only way in, so Esc means leave), or a harmless edit/no-op that stays open.
export type PasswordKeyResult = 'submit' | 'quit' | 'edit' | 'none';

// Generous cap — a passphrase can be long, but not unbounded.
const MAX_LEN = 128;

export class PasswordModal {
	private readonly container: BoxRenderable;
	private readonly input: TextRenderable;
	private readonly message: TextRenderable;
	private text = '';
	private error = '';

	constructor(ctx: RenderContext) {
		// zIndex 30: above the HUD (z10) and Shop (z20), the same layer the character
		// creator uses — both are pre-spawn, full-screen gates and never co-visible.
		this.container = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 30,
			visible: false,
		});

		const panel = new BoxRenderable(ctx, {
			flexDirection: 'column',
			width: 50,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.vendor,
			title: ' 🔒 Locked playtest ',
			titleColor: COLORS.vendor,
			backgroundColor: COLORS.hudBg,
		});
		const prompt = new TextRenderable(ctx, {
			content: 'Enter the password to play:',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		this.input = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		// Status line: the server's reason (lock notice on first prompt, "Incorrect
		// password" on a wrong retry). Empty until the first reject arrives.
		this.message = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hurt,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: '↵ enter   esc quit',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		panel.add(prompt);
		panel.add(this.input);
		panel.add(this.message);
		panel.add(footer);
		this.container.add(panel);
		this.refresh();
	}

	attach(parent: Renderable): void {
		parent.add(this.container);
	}

	get open(): boolean {
		return this.container.visible;
	}

	show(): void {
		this.container.visible = true;
		this.refresh();
	}

	hide(): void {
		this.container.visible = false;
	}

	// The typed secret, for NetClient.submitPassword.
	value(): string {
		return this.text;
	}

	// Surface the server's refusal reason and clear the entry for another attempt.
	setError(reason: string): void {
		this.error = reason;
		this.text = '';
		this.refresh();
	}

	// Feed one key while open. Mirrors ChatInput: Enter submits a non-empty entry,
	// Esc quits, Backspace edits, control/meta combos are swallowed, and any printable
	// character is appended (masked on screen). Returns 'none' when closed so the
	// caller treats the key normally.
	key(k: ChatKey): PasswordKeyResult {
		if (!this.open) return 'none';
		if (k.name === 'return') return this.text ? 'submit' : 'edit';
		if (k.name === 'escape') return 'quit';
		if (k.name === 'backspace') {
			this.text = this.text.slice(0, -1);
			this.refresh();
			return 'edit';
		}
		if (k.ctrl || k.meta) return 'edit';
		const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
		if (
			ch.length === 1 &&
			ch >= ' ' &&
			ch !== '\x7f' &&
			this.text.length < MAX_LEN
		) {
			this.text += ch;
			this.refresh();
		}
		return 'edit';
	}

	// Mask the entry as bullets so it never appears on a stream / screen-share (the
	// whole point of the gate), with a caret so an empty field still reads as active.
	private refresh(): void {
		this.input.content = `  ${'•'.repeat(this.text.length)}▏`;
		this.message.content = this.error ? `\n${this.error}\n` : '\n';
	}
}
