// The non-Kitty input notice (#228, ADR 0024 §3/§4). On a terminal confirmed NOT to
// implement the Kitty keyboard protocol, hold-to-move degrades to OS auto-repeat — a
// step-then-pause on the first beat and no simultaneous direction+action (ADR 0024
// "Context"). We can't fix that on a legacy terminal, so we NUDGE: a blocking,
// press-any-key overlay every launch (no opt-out, no persistence) that names the fault
// and how to escape it. Detection is proactive off the terminal's resolved capabilities,
// and fail-open — silent unless we are CONFIDENT the protocol is absent.
//
// In the Shop / Controls / AudioOptions overlay mold: an absolute, centered panel on the
// modal layer. The predicate + terminal list are pure and exported for unit tests
// (no TTY needed); the rendered overlay is the client's business.

import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	type TerminalCapabilities,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

// Fail-open predicate (ADR 0024 §2). Warn ONLY when the startup probe has RESOLVED
// (`capabilities` is non-null) AND it reports the Kitty keyboard protocol as absent.
// The capability object is `null` until the probe resolves, so an unresolved / timed-out
// (e.g. high-latency SSH) / unknown state returns false — no warning. `kitty_keyboard` is
// checked with strict `=== false` so any non-boolean/undefined value also stays silent.
export function shouldWarnNoKitty(
	capabilities: TerminalCapabilities | null | undefined,
): boolean {
	return capabilities != null && capabilities.kitty_keyboard === false;
}

// A SHORT, build-time-verified list of terminals that implement the Kitty keyboard
// protocol (source: the kitty keyboard-protocol spec's "Terminals that support this
// protocol" list, https://sw.kovidgoyal.net/kitty/keyboard-protocol/ — verified for #228).
// Kept short on purpose: it ships with the binary and goes stale, so it must be
// re-verified each release (ADR 0024 §4). Names only, no URL.
export const KITTY_TERMINALS: readonly string[] = [
	'Kitty',
	'Ghostty',
	'WezTerm',
	'foot',
	'Alacritty',
	'iTerm2',
];

// The one-line multiplexer caveat (ADR 0024 §4): a supported terminal can still fail the
// probe because tmux/screen sits between and strips the protocol.
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

// The blocking, press-any-key notice (ADR 0024 §3; #301). Modeled on Controls: an absolute,
// centered panel, but on a STRICT pre-gate layer (zIndex 40 — above the character creator's
// own z30 and every z20 modal). It is a sequential pre-gate: it must draw over anything else
// that could appear at launch and win visually, not just behaviourally, so the Player can
// actually read it (#301 — the creator used to attach later at the same z30 and paint on
// top). It carries NO dismissal state of its own beyond visibility: shown fresh each launch
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
// and toggle it. Both the NoKittyNotice and the character creator already satisfy it.
export interface Gateable {
	readonly open: boolean;
	show(): void;
	hide(): void;
}

// The strict sequential pre-gate (#301). While the no-Kitty notice owns the screen and the
// keyboard, nothing else may be drawn or take input: any modal that wants to appear at
// launch (the Avatar creator today, post-connect UI later) is REQUESTED here and shown only
// while the gate is CLEAR — the notice was never raised, or it was and the Player dismissed
// it. This tracks intent (a requested modal WANTS to be up) separately from the notice
// state and reconciles the two, so a notice that resolves LATE (a slow / high-latency SSH
// probe) still wins: reconcile() hides a modal already on screen and re-shows it on
// dismissal. A never-resolving probe is fail-open (no notice), so requested modals appear
// immediately and are never stranded. Pure of any renderer, so the gate is unit-testable.
export class NoticeGate {
	private readonly wanted = new Set<Gateable>();

	constructor(private readonly notice: { readonly open: boolean }) {}

	// Register a modal as wanting the screen and reconcile now: it appears immediately when
	// the gate is clear, or is held hidden until the notice is dismissed.
	request(modal: Gateable): void {
		this.wanted.add(modal);
		this.reconcile();
	}

	// The modal is finished with the gate (e.g. the creator was confirmed): stop tracking it
	// so reconcile() can never re-show it, and hide it now.
	release(modal: Gateable): void {
		this.wanted.delete(modal);
		if (modal.open) modal.hide();
	}

	// Re-derive every tracked modal's visibility from the notice: held hidden while the
	// notice is open, shown once it is clear. Call after the notice opens or is dismissed.
	reconcile(): void {
		const blocked = this.notice.open;
		for (const modal of this.wanted) {
			if (blocked) {
				if (modal.open) modal.hide();
			} else if (!modal.open) modal.show();
		}
	}
}
