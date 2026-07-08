// The bottom-left message log + chat (#272): an OpenTUI ScrollBoxRenderable — a fixed
// viewport that word-wraps, culls off-screen rows, keeps scrollback, and pins to the
// newest line via `stickyStart:'bottom'` — plus an InputRenderable for the chat line.
// Focus routing (game keys inert while typing) is owned by the caller.

import { CHAT_MAX_LEN, type Rarity } from '@mmo/shared';
import {
	BoxRenderable,
	fg,
	InputRenderable,
	InputRenderableEvents,
	type RenderContext,
	ScrollBoxRenderable,
	type StyledText,
	TextRenderable,
	t,
} from '@opentui/core';
import { COLORS, RARITY_RGBA } from './theme';

const LOG_WIDTH = 60; // viewport width in cells; text word-wraps to fit
const LOG_HEIGHT = 6; // viewport height in rows (scrollback lives above it)
const LINE_WIDTH = LOG_WIDTH - 1; // leave a column for the vertical scrollbar
const MAX_LINES = 200; // retained scrollback; older lines are evicted

// A loot pickup line, matched so the item label can be tinted to its rarity — the same
// visual language the in-world Drop uses (#238).
const LOOTED_RE = /^Looted (common|uncommon|rare|epic|legendary) (.+)\.$/;

// A loot pickup is coloured by item rarity (label tinted, framing words dim); every other
// line renders as a plain string.
export function styleLogLine(line: string): StyledText | string {
	const m = LOOTED_RE.exec(line);
	if (!m) return line;
	const rarity = m[1] as Rarity;
	return t`${fg(COLORS.dim)('Looted ')}${fg(RARITY_RGBA[rarity])(`${m[1]} ${m[2]}`)}${fg(COLORS.dim)('.')}`;
}

// The lines appended to `curr` since it last equalled `prev`. Both logs are append-at-end
// / evict-from-front buffers, so the new tail is `curr` with its longest suffix-of-`prev`
// prefix removed. Returns all of `curr` when there is no overlap (first sync, or a full
// rotation).
export function appendedTail(prev: string[], curr: string[]): string[] {
	for (let start = 0; start <= prev.length; start++) {
		const overlap = prev.slice(start);
		if (
			overlap.length <= curr.length &&
			overlap.every((v, i) => v === curr[i])
		) {
			return curr.slice(overlap.length);
		}
	}
	return curr.slice();
}

export class MessageLog {
	// The scrolling display (game log + chat, interleaved) and the chat input row.
	readonly scrollBox: ScrollBoxRenderable;
	readonly inputRow: BoxRenderable;
	private readonly input: InputRenderable;
	private readonly ctx: RenderContext;
	// Line ids oldest first, so the eldest can be evicted when the window overflows.
	private readonly lineIds: string[] = [];
	// Last-synced windows, diffed each sync to append only the net-new tail (never rebuild,
	// so scroll position + history survive).
	private seenLog: string[] = [];
	private seenChat: string[] = [];
	// Fired when the Player submits a chat line (Enter).
	onSubmit?: (text: string) => void;

	constructor(ctx: RenderContext) {
		this.ctx = ctx;
		this.scrollBox = new ScrollBoxRenderable(ctx, {
			width: LOG_WIDTH,
			height: LOG_HEIGHT,
			backgroundColor: COLORS.bg,
			// Pin to the newest line; older lines stay reachable by scrolling up.
			stickyScroll: true,
			stickyStart: 'bottom',
			scrollY: true,
			scrollX: false,
			rootOptions: { backgroundColor: COLORS.bg },
			wrapperOptions: { backgroundColor: COLORS.bg },
			viewportOptions: { backgroundColor: COLORS.bg },
			contentOptions: {
				backgroundColor: COLORS.bg,
				flexDirection: 'column',
			},
		});
		// A dim `say ▸` prompt beside a single-line input; only interactive once focused.
		this.inputRow = new BoxRenderable(ctx, {
			width: LOG_WIDTH,
			flexDirection: 'row',
			backgroundColor: COLORS.bg,
		});
		this.inputRow.add(
			new TextRenderable(ctx, {
				content: 'say ▸ ',
				fg: COLORS.dim,
				bg: COLORS.bg,
			}),
		);
		this.input = new InputRenderable(ctx, {
			flexGrow: 1,
			// Cap the draft at the shared chat length, matching the server's relay clamp, so a
			// line that fits here is never truncated on the wire (#59).
			maxLength: CHAT_MAX_LEN,
			backgroundColor: COLORS.bg,
			focusedBackgroundColor: COLORS.bg,
			textColor: COLORS.telegraph,
			focusedTextColor: COLORS.telegraph,
			placeholder: 'press ⏎ to chat',
			placeholderColor: COLORS.dim,
		});
		// Enter submits the value; the caller parses, relays, then closes chat.
		this.input.on(InputRenderableEvents.ENTER, (value: string) => {
			this.onSubmit?.(value);
		});
		this.inputRow.add(this.input);
	}

	// Whether chat owns the keyboard. The caller gates game input on this so movement /
	// combat / menu keys never fire while typing.
	get chatOpen(): boolean {
		return this.input.focused;
	}

	// Focus the input so keystrokes edit the line. The caller must consume the opening key
	// (preventDefault) so it isn't also delivered to the freshly-focused input.
	openChat(): void {
		this.input.focus();
	}

	// Leave typing mode, discarding any draft.
	closeChat(): void {
		this.input.value = '';
		this.input.blur();
	}

	// Append the game-log lines added since the last call, a loot line tinted by rarity.
	// Incremental so scrollback survives; driven each frame from `player.log`.
	syncLog(log: string[]): void {
		for (const line of appendedTail(this.seenLog, log))
			this.push(styleLogLine(line));
		this.seenLog = log.slice();
	}

	// Append the chat lines added since the last call, coloured as chat. Driven from
	// `NetClient.chatLog`.
	syncChat(chat: string[]): void {
		for (const line of appendedTail(this.seenChat, chat))
			this.push(t`${fg(COLORS.chat)(line)}`);
		this.seenChat = chat.slice();
	}

	// Append one line as a word-wrapping row, evicting the eldest when the window overflows.
	private push(content: string | StyledText): void {
		const line = new TextRenderable(this.ctx, {
			content,
			fg: COLORS.dim,
			bg: COLORS.bg,
			width: LINE_WIDTH,
			wrapMode: 'word',
		});
		this.scrollBox.add(line);
		this.lineIds.push(line.id);
		while (this.lineIds.length > MAX_LINES) {
			const id = this.lineIds.shift();
			if (id) this.scrollBox.remove(id);
		}
	}
}
