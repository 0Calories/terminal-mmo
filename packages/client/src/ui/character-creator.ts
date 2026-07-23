import {
	BOX,
	type Cosmetics,
	DEFAULT_FORM_ID,
	type Entity,
} from '@mmo/core/entities';
import { maxHpForLevel } from '@mmo/core/progression';
import { HAT_IDS, hatById, spriteFor } from '@mmo/render';
import { Compositor } from '@mmo/render/compositor';
import { drawNameplates } from '@mmo/render/scene';
import { paintActor } from '@mmo/render/sprites';
import {
	BoxRenderable,
	InputRenderable,
	InputRenderableEvents,
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type Renderable as RenderableType,
	type RenderContext,
	TextRenderable,
} from '@opentui/core';
import { encodeToBuffer } from '../render/compositor-sink';
import { COLORS } from '../theme';
import {
	CUSTOMIZE_FIELDS,
	type CustomizeState,
	customizeRows,
	effectiveHandle,
	filterHandleDraft,
	HANDLE_MAX_LEN,
	handleConfirmable,
	initCustomize,
	reduceCustomize,
} from './customize';

export interface CreatorKey {
	name: string;
	sequence: string;
	ctrl: boolean;
	meta: boolean;
	preventDefault?: () => void;
}

export interface CreatorResult {
	handle: string;
	cosmetics: Cosmetics;
}

export const PLAYER = spriteFor('player');
export const NAMEPLATE_H = 2;
const MAX_HAT_H = Math.max(0, ...HAT_IDS.map((id) => hatById(id)?.h ?? 0));
export const VPAD = 1;
const PREVIEW_W = PLAYER.w + 12;
export const PREVIEW_H = MAX_HAT_H + PLAYER.h + NAMEPLATE_H + 2 * VPAD;

export function previewAvatar(cosmetics: Cosmetics, name: string): Entity {
	const spriteTop = VPAD + MAX_HAT_H;
	const spriteLeft = Math.round((PREVIEW_W - PLAYER.w) / 2);
	return {
		id: 1,
		type: 'player',
		name,
		cosmetics,
		x: spriteLeft + Math.floor((PLAYER.w - BOX.w) / 2),
		y: spriteTop - (BOX.h - PLAYER.h),
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: maxHpForLevel(1),
		maxHp: maxHpForLevel(1),
		hurtT: 0,
		attackT: 0,
	};
}

class PreviewRenderable extends Renderable {
	avatar: Entity = previewAvatar(
		{ hue: 0, hat: '', nameplate: 0, form: DEFAULT_FORM_ID },
		'',
	);

	private compositor: Compositor | null = null;

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		super(ctx, { live: true, buffered: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		const w = Math.max(1, buffer.width);
		const h = Math.max(1, buffer.height);
		if (
			!this.compositor ||
			this.compositor.widthCells !== w ||
			this.compositor.heightCells !== h
		)
			this.compositor = new Compositor(w, h);
		const compositor = this.compositor;
		const cam = { x: 0, y: 0 };
		compositor.clear();
		paintActor(compositor, this.avatar, cam);
		drawNameplates(compositor, [this.avatar], cam);
		encodeToBuffer(compositor, buffer);
	}
}

export class CharacterCreator {
	private readonly container: BoxRenderable;
	private readonly preview: PreviewRenderable;
	private readonly handleInput: InputRenderable;
	private readonly namePrompt: TextRenderable;
	private readonly hint: TextRenderable;
	private readonly footer: TextRenderable;
	private readonly rows: TextRenderable;
	private state: CustomizeState;
	private readonly placeholder: string;
	private handleText = '';
	private nameRowFocused = false;
	private errorText = '';
	private busy = false;
	private readonly editableHandle: boolean;

	constructor(
		ctx: RenderContext,
		handle: string,
		start: Cosmetics,
		editableHandle = true,
	) {
		this.placeholder = handle;
		this.editableHandle = editableHandle;
		this.state = initCustomize(start);
		this.nameRowFocused = editableHandle;

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
			alignItems: 'center',
			width: 40,
			padding: 1,
			border: true,
			borderStyle: 'single',
			borderColor: COLORS.vendor,
			title: editableHandle ? ' Create your Avatar ' : ' Re-customize ',
			titleColor: COLORS.vendor,
			backgroundColor: COLORS.hudBg,
		});

		this.preview = new PreviewRenderable(ctx, {
			width: PREVIEW_W,
			height: PREVIEW_H,
		});
		const handleRow = new BoxRenderable(ctx, {
			flexDirection: 'row',
			alignItems: 'center',
			width: 36,
			backgroundColor: COLORS.hudBg,
		});
		this.namePrompt = new TextRenderable(ctx, {
			content: '  name ▸ ',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		handleRow.add(this.namePrompt);
		this.handleInput = new InputRenderable(ctx, {
			flexGrow: 1,
			maxLength: HANDLE_MAX_LEN,
			backgroundColor: COLORS.hudBg,
			focusedBackgroundColor: COLORS.hudBg,
			textColor: COLORS.hud,
			focusedTextColor: COLORS.hud,
			placeholder: this.placeholder,
			placeholderColor: COLORS.dim,
		});
		this.handleInput.on(InputRenderableEvents.INPUT, (raw: string) => {
			if (!this.editableHandle) return;
			const filtered = filterHandleDraft(raw);
			if (filtered !== raw) this.handleInput.value = filtered;
			this.handleText = filtered;
			this.errorText = '';
			this.refresh();
		});
		handleRow.add(this.handleInput);
		this.hint = new TextRenderable(ctx, {
			content: ' ',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});
		this.rows = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.hud,
			bg: COLORS.hudBg,
		});
		this.footer = new TextRenderable(ctx, {
			content: '',
			fg: COLORS.dim,
			bg: COLORS.hudBg,
		});

		panel.add(this.preview);
		if (editableHandle) {
			panel.add(handleRow);
			panel.add(this.hint);
		}
		panel.add(this.rows);
		panel.add(this.footer);
		this.container.add(panel);
		this.refresh();
	}

	attach(parent: RenderableType): void {
		parent.add(this.container);
	}

	get open(): boolean {
		return this.container.visible;
	}

	get errorMessage(): string {
		return this.errorText;
	}

	get focusedRow(): string {
		if (this.nameFocused) return 'name';
		return CUSTOMIZE_FIELDS[this.state.field]?.key ?? '';
	}

	get effectiveName(): string {
		return effectiveHandle(this.handleText, this.placeholder);
	}

	private get nameFocused(): boolean {
		return this.editableHandle && this.nameRowFocused;
	}

	private syncFieldFocus(): void {
		if (!this.editableHandle) return;
		if (this.nameFocused) this.handleInput.focus();
		else this.handleInput.blur();
	}

	get confirmable(): boolean {
		return this.editableHandle
			? handleConfirmable(this.handleText, this.placeholder)
			: true;
	}

	reopen(cosmetics: Cosmetics): void {
		this.state = initCustomize(cosmetics);
		this.errorText = '';
		this.busy = false;
		this.refresh();
	}

	show(): void {
		this.container.visible = true;
		this.syncFieldFocus();
	}

	hide(): void {
		this.container.visible = false;
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		if (busy) this.handleInput.blur();
		else this.syncFieldFocus();
		this.refresh();
	}

	showRejection(reason: 'taken' | 'invalid'): void {
		this.busy = false;
		this.errorText =
			reason === 'taken'
				? 'that name is taken'
				: 'invalid name — 2–16 of letters, digits, - or _';
		if (this.editableHandle) this.nameRowFocused = true;
		this.syncFieldFocus();
		this.refresh();
	}

	key(k: CreatorKey): CreatorResult | null {
		if (this.busy) return null;
		const { name } = k;
		if (name === 'up' || name === 'down') {
			this.moveFocus(name === 'down' ? 1 : -1);
			k.preventDefault?.();
			return null;
		}
		if (name === 'return') {
			if (!this.confirmable) return null;
			k.preventDefault?.();
			return {
				handle: this.editableHandle
					? effectiveHandle(this.handleText, this.placeholder)
					: this.placeholder,
				cosmetics: this.state.cosmetics,
			};
		}

		if (this.nameFocused) return null;
		const { state } = reduceCustomize(this.state, name);
		this.state = state;
		this.refresh();
		return null;
	}

	private moveFocus(delta: number): void {
		if (!this.editableHandle) {
			this.state = reduceCustomize(this.state, delta > 0 ? 'down' : 'up').state;
			this.refresh();
			return;
		}
		const ladderLen = CUSTOMIZE_FIELDS.length + 1;
		const pos = this.nameRowFocused ? 0 : this.state.field + 1;
		const next = (((pos + delta) % ladderLen) + ladderLen) % ladderLen;
		this.nameRowFocused = next === 0;
		if (next !== 0) this.state = { ...this.state, field: next - 1 };
		this.syncFieldFocus();
		this.refresh();
	}

	private refresh(): void {
		this.preview.avatar = previewAvatar(
			this.state.cosmetics,
			effectiveHandle(this.handleText, this.placeholder),
		);
		const focused = this.nameFocused;
		if (this.editableHandle) {
			this.namePrompt.content = `${focused ? '▸' : ' '} name ▸ `;
			if (this.errorText) {
				this.hint.content = this.errorText;
				this.hint.fg = COLORS.warn;
			} else {
				this.hint.content = ' ';
				this.hint.fg = COLORS.dim;
			}
		}
		const lines = customizeRows(this.state).map((r) => {
			const caret = r.focused && !focused ? '▸' : ' ';
			return `${caret} ${r.label.padEnd(10)} ◂ ${r.value} ▸`;
		});
		this.rows.content = `\n${lines.join('\n')}\n`;
		this.footer.content = this.busy
			? this.editableHandle
				? 'creating…'
				: 'saving…'
			: this.editableHandle
				? this.confirmable
					? 'type a name   ↑/↓ field   ←/→ change   ↵ enter the World'
					: 'type a name   ↑/↓ field   ←/→ change'
				: '↑/↓ field   ←/→ change   ↵ save   esc cancel';
	}
}
