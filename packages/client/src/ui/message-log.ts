import { CHAT_MAX_LEN, type Rarity } from '@mmo/core';
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
import { COLORS, RARITY_RGBA } from '../theme';

const LOG_WIDTH = 60;
const LOG_HEIGHT = 6;
const LINE_WIDTH = LOG_WIDTH - 1; // -1 leaves a column for the scrollbar
const MAX_LINES = 200;

const LOOTED_RE = /^Looted (common|uncommon|rare|epic|legendary) (.+)\.$/;

export function styleLogLine(line: string): StyledText | string {
	const m = LOOTED_RE.exec(line);
	if (!m) return line;
	const rarity = m[1] as Rarity;
	return t`${fg(COLORS.dim)('Looted ')}${fg(RARITY_RGBA[rarity])(`${m[1]} ${m[2]}`)}${fg(COLORS.dim)('.')}`;
}

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
	readonly scrollBox: ScrollBoxRenderable;
	readonly inputRow: BoxRenderable;
	private readonly input: InputRenderable;
	private readonly ctx: RenderContext;
	private readonly lineIds: string[] = [];
	private seenLog: string[] = [];
	private seenChat: string[] = [];
	onSubmit?: (text: string) => void;

	constructor(ctx: RenderContext) {
		this.ctx = ctx;
		this.scrollBox = new ScrollBoxRenderable(ctx, {
			width: LOG_WIDTH,
			height: LOG_HEIGHT,
			backgroundColor: COLORS.bg,
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
			// Match the server's relay clamp so a line that fits here isn't truncated on the wire.
			maxLength: CHAT_MAX_LEN,
			backgroundColor: COLORS.bg,
			focusedBackgroundColor: COLORS.bg,
			textColor: COLORS.telegraph,
			focusedTextColor: COLORS.telegraph,
			placeholder: 'press ⏎ to chat',
			placeholderColor: COLORS.dim,
		});
		this.input.on(InputRenderableEvents.ENTER, (value: string) => {
			this.onSubmit?.(value);
		});
		this.inputRow.add(this.input);
	}

	get chatOpen(): boolean {
		return this.input.focused;
	}

	// Caller must consume the opening key so it isn't delivered to the freshly-focused input.
	openChat(): void {
		this.input.focus();
	}

	closeChat(): void {
		this.input.value = '';
		this.input.blur();
	}

	syncLog(log: string[]): void {
		for (const line of appendedTail(this.seenLog, log))
			this.push(styleLogLine(line));
		this.seenLog = log.slice();
	}

	syncChat(chat: string[]): void {
		for (const line of appendedTail(this.seenChat, chat))
			this.push(t`${fg(COLORS.chat)(line)}`);
		this.seenChat = chat.slice();
	}

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
