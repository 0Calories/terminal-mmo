// The non-Kitty input notice (#228, ADR 0024 §3/§4). On a terminal confirmed NOT to
// implement the Kitty keyboard protocol, hold-to-move degrades to OS auto-repeat and
// direction+action can't combine. We can't fix that on a legacy terminal, so we NUDGE:
// a blocking, press-any-key overlay every launch (no opt-out, no persistence). Detection
// is fail-open — silent unless we are CONFIDENT the protocol is absent.

import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	type TerminalCapabilities,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

// Fail-open: warn ONLY once the probe has RESOLVED (`capabilities` non-null) AND reports
// the protocol absent. Null (unresolved / timed-out / high-latency SSH) returns false.
// Strict `=== false`, so any non-boolean also stays silent (ADR 0024 §2).
export function shouldWarnNoKitty(
	capabilities: TerminalCapabilities | null | undefined,
): boolean {
	return capabilities != null && capabilities.kitty_keyboard === false;
}

// Terminals implementing the Kitty keyboard protocol (source: the protocol spec's
// support list). Kept short on purpose: it ships with the binary and goes stale, so
// re-verify each release (ADR 0024 §4).
export const KITTY_TERMINALS: readonly string[] = [
	'Kitty',
	'Ghostty',
	'WezTerm',
	'foot',
	'Alacritty',
	'iTerm2',
];

// A supported terminal can still fail the probe if tmux/screen strips the protocol
// (ADR 0024 §4).
export const MULTIPLEXER_CAVEAT =
	'Inside tmux or screen? The multiplexer can strip the protocol — try a bare terminal.';

const BODY = [
	'This terminal does not report the Kitty keyboard protocol, so',
	'held-key movement will feel sticky: a pause on the first step,',
	"and you can't hold a direction while attacking or jumping.",
	'',
	'Terminals that support the protocol:',
	`  ${KITTY_TERMINALS.join('  ·  ')}`,
	'',
	MULTIPLEXER_CAVEAT,
].join('\n');

// The blocking, press-any-key notice (ADR 0024 §3; #301). Absolute centered panel on a
// STRICT pre-gate layer (zIndex 40 — above the creator's z30 and every z20 modal): it must
// win visually, not just behaviourally, so the Player can read it. Shown fresh each launch
// when detection confirms no-Kitty, dismissed by the first key press, never persisted.
export class NoKittyNotice {
	private readonly container: BoxRenderable;

	constructor(ctx: RenderContext) {
		this.container = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 40,
			visible: false,
		});

		const panel = new BoxRenderable(ctx, {
			flexDirection: 'column',
			width: 66,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.hurt,
			title: ' Controls may feel sticky ',
			titleColor: COLORS.hurt,
			backgroundColor: COLORS.hudBg,
		});
		const body = new TextRenderable(ctx, {
			content: `\n${BODY}\n`,
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		const footer = new TextRenderable(ctx, {
			content: 'Press any key to continue',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		panel.add(body);
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
		this.container.visible = true;
	}

	hide(): void {
		this.container.visible = false;
	}
}

// A modal the pre-gate can hold behind the notice: enough surface to read its visibility
// and toggle it.
export interface Gateable {
	readonly open: boolean;
	show(): void;
	hide(): void;
}

// The strict sequential pre-gate (#301). A modal that wants to appear at launch (the Avatar
// creator today, post-connect UI later) is REQUESTED here and shown only while the gate is
// CLEAR — the notice was never raised, or it was and the Player dismissed it. Tracking intent
// separately from the notice state lets a LATE-resolving probe (a slow / high-latency SSH
// probe) still win: reconcile() hides a modal already on screen and re-shows it on dismissal.
// A never-resolving probe is fail-open, so requested modals appear immediately.
export class NoticeGate {
	private readonly wanted = new Set<Gateable>();

	constructor(private readonly notice: { readonly open: boolean }) {}

	// Register a modal as wanting the screen and reconcile now.
	request(modal: Gateable): void {
		this.wanted.add(modal);
		this.reconcile();
	}

	// The modal is done with the gate: stop tracking it so reconcile() can't re-show it,
	// and hide it now.
	release(modal: Gateable): void {
		this.wanted.delete(modal);
		if (modal.open) modal.hide();
	}

	// Re-derive every tracked modal's visibility from the notice. Call after the notice
	// opens or is dismissed.
	reconcile(): void {
		const blocked = this.notice.open;
		for (const modal of this.wanted) {
			if (blocked) {
				if (modal.open) modal.hide();
			} else if (!modal.open) modal.show();
		}
	}
}
