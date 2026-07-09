import {
	BoxRenderable,
	type Renderable,
	type RenderContext,
	type TerminalCapabilities,
	TextRenderable,
} from '@opentui/core';
import { COLORS } from './theme';

// Fail-open: warn only when the probe resolved and reports absent; strict === false keeps non-booleans silent.
export function shouldWarnNoKitty(
	capabilities: TerminalCapabilities | null | undefined,
): boolean {
	return capabilities != null && capabilities.kitty_keyboard === false;
}

export const KITTY_TERMINALS: readonly string[] = [
	'Kitty',
	'Ghostty',
	'WezTerm',
	'foot',
	'Alacritty',
	'iTerm2',
];

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
			zIndex: 40, // above the creator (z30) and every z20 modal
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

export interface Gateable {
	readonly open: boolean;
	show(): void;
	hide(): void;
}

export class NoticeGate {
	private readonly wanted = new Set<Gateable>();

	constructor(private readonly notice: { readonly open: boolean }) {}

	request(modal: Gateable): void {
		this.wanted.add(modal);
		this.reconcile();
	}

	release(modal: Gateable): void {
		this.wanted.delete(modal);
		if (modal.open) modal.hide();
	}

	reconcile(): void {
		const blocked = this.notice.open;
		for (const modal of this.wanted) {
			if (blocked) {
				if (modal.open) modal.hide();
			} else if (!modal.open) modal.show();
		}
	}
}
