import type { TerminalCapabilities } from '@opentui/core';

export function shouldWarnNoKitty(
	capabilities: TerminalCapabilities | null | undefined,
): boolean {
	return capabilities != null && capabilities.kitty_keyboard === false;
}

export const KITTY_PROBE_SETTLE_MS = 500;

interface Notice {
	readonly open: boolean;
	show(): void;
	hide(): void;
}

export interface KittyProbeDeps {
	notice: Notice;
	capabilities(): TerminalCapabilities | null | undefined;

	onNoticeChanged(): void;
	settleMs?: number;
	setTimer?(fn: () => void, ms: number): unknown;
	clearTimer?(handle: unknown): void;
}

export class KittyProbe {
	private confirmed = false;
	private timer: unknown = null;
	private readonly settleMs: number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(private readonly deps: KittyProbeDeps) {
		this.settleMs = deps.settleMs ?? KITTY_PROBE_SETTLE_MS;
		this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
		this.clearTimer =
			deps.clearTimer ??
			((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

		if (deps.capabilities()?.kitty_keyboard === true) this.confirmed = true;
	}

	observe(capabilities: TerminalCapabilities | null): void {
		if (capabilities?.kitty_keyboard === true) {
			this.confirmed = true;
			this.cancelTimer();
			if (this.deps.notice.open) this.dismiss();
			return;
		}
		if (this.confirmed) return;
		this.cancelTimer();
		this.timer = this.setTimer(() => this.warnNow(), this.settleMs);
	}

	dismiss(): void {
		this.deps.notice.hide();
		this.deps.onNoticeChanged();
	}

	private warnNow(): void {
		this.timer = null;
		if (this.confirmed || this.deps.notice.open) return;
		if (!shouldWarnNoKitty(this.deps.capabilities())) return;
		this.deps.notice.show();
		this.deps.onNoticeChanged();
	}

	private cancelTimer(): void {
		if (this.timer === null) return;
		this.clearTimer(this.timer);
		this.timer = null;
	}
}
