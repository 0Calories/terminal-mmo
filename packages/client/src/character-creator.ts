// The character-customization screen (#36, ADR 0005): the Player cycles cosmetics over a live
// Avatar preview, then confirms. The picker LOGIC is the pure, tested customize.ts — this file
// is rendering only, validated by eye. One imperative preview node sits inside the retained-UI
// shell, the same imperative-inside-renderSelf seam the playfield uses.
import type { Cosmetics, Entity, RenderStyle } from '@mmo/shared';
import {
	BOX,
	buildSceneStyle,
	drawNameplates,
	HATS,
	maxHpForLevel,
	renderZoneScene,
	spriteFor,
} from '@mmo/shared';
import {
	BoxRenderable,
	InputRenderable,
	InputRenderableEvents,
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type Renderable as RenderableType,
	type RenderContext,
	RGBA,
	TextRenderable,
} from '@opentui/core';
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
import { COLORS } from './theme';

// The subset of an OpenTUI key event the creator reads. Typed structurally so this module doesn't
// depend on an un-exported opentui key type. `preventDefault` swallows a key so the focused name
// input doesn't ALSO see it (↑/↓ move focus, ↵ confirms).
export interface CreatorKey {
	name: string;
	sequence: string;
	ctrl: boolean;
	meta: boolean;
	preventDefault?: () => void;
}

// The finalised choice handed back on confirm (#304); index.ts sends both in `createAvatar`.
export interface CreatorResult {
	handle: string;
	cosmetics: Cosmetics;
}

// Same colour binding the playfield uses, so the preview can't drift from how the Avatar ships
// in-world (#56).
const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// Preview geometry, derived from the real Sprite / hat catalog. The drawn stack is hat + Sprite
// + nameplate with a row of padding either side; the canvas is sized for the tallest possible
// stack so no selection ever clips (#103).
export const PLAYER = spriteFor('player');
// A single handle row below the feet (ADR 0023) plus one row of slack for a form's baseline
// offset, so it never clips.
export const NAMEPLATE_H = 2;
const MAX_HAT_H = Math.max(0, ...HATS.map((h) => h.sprite?.h ?? 0));
export const VPAD = 1;
const PREVIEW_W = PLAYER.w + 12; // Sprite plus room for a short handle either side
export const PREVIEW_H = MAX_HAT_H + PLAYER.h + NAMEPLATE_H + 2 * VPAD;

// A still preview Avatar (facing right, full health) carrying the in-progress cosmetics +
// handle. The Sprite is ANCHORED at a fixed vertical position (headroom reserved for the
// tallest hat), so cycling hats only moves the headwear, never the body/feet (#104). x/y invert
// drawEntitySprite's placement so the resolved Sprite lands where intended.
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

// A live node that draws the preview Avatar through the shared renderer's full path, so the
// preview is exactly what ships in-world. `live` so it redraws every frame; `avatar` is swapped
// on each picker change.
class PreviewRenderable extends Renderable {
	avatar: Entity = previewAvatar({ hue: 0, hat: 0, nameplate: 0, form: 0 }, '');

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		// `buffered` gives this node its OWN frame buffer: renderSelf draws at local 0,0 and
		// opentui composites it at the laid-out position. Without it, renderSelf would draw onto
		// the root buffer at absolute 0,0 and renderZoneScene's clear would wipe everything.
		super(ctx, { live: true, buffered: true, ...options });
	}

	protected renderSelf(buffer: OptimizedBuffer): void {
		const terrain = {
			w: buffer.width,
			h: buffer.height,
			cells: new Uint8Array(buffer.width * buffer.height),
		};
		renderZoneScene(
			buffer,
			{ terrain, portals: [], npcs: [], entities: [this.avatar] },
			{ x: 0, y: 0 },
			STYLE,
		);
		// Nameplates are a caller-composited top layer (ADR 0023), so add the pass here. Unlike the
		// playfield this SHOWS the self plate, since it's a preview.
		drawNameplates(buffer, [this.avatar], { x: 0, y: 0 }, terrain, STYLE);
	}
}

// Mirrors the Shop's structure and key-routing contract: index.ts feeds keys to `key()`, which
// returns the chosen result on Enter (else null) and refreshes the preview itself.
export class CharacterCreator {
	private readonly container: BoxRenderable;
	private readonly preview: PreviewRenderable;
	private readonly handleInput: InputRenderable;
	private readonly namePrompt: TextRenderable;
	private readonly hint: TextRenderable;
	private readonly footer: TextRenderable;
	private readonly rows: TextRenderable;
	private state: CustomizeState;
	// The auto-derived Handle ($USER / MMO_HANDLE): the field placeholder, used verbatim when the
	// Player leaves the field empty (#304).
	private readonly placeholder: string;
	// The Player-typed name draft, kept in sync with the focused InputRenderable via its INPUT
	// event — the input owns the text (#315). Empty ⇒ the placeholder is used on confirm.
	private handleText = '';
	// Whether the name row (row 0) owns focus: when true the InputRenderable is `.focus()`'d and
	// owns typing + left/right cursor; ↑/↓ move focus onto a cosmetic row. Inert in re-customize
	// mode (no name row — #315).
	private nameRowFocused = false;
	// A server `createRejected` (taken / invalid), surfaced inline; cleared when the Player edits
	// the name again.
	private errorText = '';
	// True between sending `createAvatar` and the server's verdict: input is frozen so the draft
	// can't change mid round-trip.
	private busy = false;
	// Creation mode (#304) lets the Player type the name; re-customize (#305, [c] in Town) reopens
	// the SAME creator with the Handle set-once and read-only, editing Cosmetics only — confirm is
	// then always allowed (ADR 0028).
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
		// Creation opens with the name row focused; re-customize has no name row and opens on the
		// first cosmetic (#315). The actual `.focus()` fires in show().
		this.nameRowFocused = editableHandle;

		this.container = new BoxRenderable(ctx, {
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: 'center',
			alignItems: 'center',
			zIndex: 30, // above HUD (z10) and Shop (z20)
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
		// The name field: a `name ▸` prompt beside the shared InputRenderable (the chat widget). On
		// the name row this input is genuinely `.focus()`'d and owns typing + cursor (#315); the
		// creator no longer hand-drives its value. Labelled "name" though the domain term stays Handle;
		// maxLength mirrors the Handle rule, charset filtering happens in the INPUT listener below.
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
		// Live-filter + live preview on each keystroke: the input hands us its whole value, we strip
		// anything outside the shared Handle charset (length is capped by maxLength), clear any standing
		// rejection, and refresh so the preview nameplate tracks what's typed. Re-assigning `value`
		// re-fires INPUT, but the next pass is already clean so it settles at once. Read-only mode never
		// focuses the field, so this is inert there.
		this.handleInput.on(InputRenderableEvents.INPUT, (raw: string) => {
			if (!this.editableHandle) return;
			const filtered = filterHandleDraft(raw);
			if (filtered !== raw) this.handleInput.value = filtered;
			this.handleText = filtered;
			this.errorText = '';
			this.refresh();
		});
		handleRow.add(this.handleInput);
		// A transient line below the name field: blank by default (row reserved so nothing jumps),
		// carrying a server rejection in warn colour only while one stands (#315). Creation-only — the
		// cosmetics-only re-customize modal mounts neither name row nor this line (#318).
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
		// The name row and its hint line exist only in creation mode; re-customize is cosmetics-only
		// (ADR 0028, #318). The preview above still renders the durable name (refresh reads the
		// placeholder).
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

	// Exposed so a test can assert a `createRejected` surfaced without a renderer.
	get errorMessage(): string {
		return this.errorText;
	}

	// The focused ladder row: 'name' when the name field owns typing, else the focused cosmetic's
	// key. Exposed so a headless test can assert ↑/↓ navigation on the public surface.
	get focusedRow(): string {
		if (this.nameFocused) return 'name';
		return CUSTOMIZE_FIELDS[this.state.field]?.key ?? '';
	}

	// The name that would be submitted right now (typed draft, or placeholder when empty). Exposed
	// so a test can assert an illegal keystroke left it unchanged.
	get effectiveName(): string {
		return effectiveHandle(this.handleText, this.placeholder);
	}

	// True while the name row is focused and thus owns typing — the predicate the focus/caret logic
	// keys off. Only meaningful in creation mode.
	private get nameFocused(): boolean {
		return this.editableHandle && this.nameRowFocused;
	}

	// Reconcile the InputRenderable's OS-level focus with the ladder: the field owns the keyboard
	// exactly while the name row is focused. Re-customize mounts no name field (#318).
	private syncFieldFocus(): void {
		if (!this.editableHandle) return;
		if (this.nameFocused) this.handleInput.focus();
		else this.handleInput.blur();
	}

	// Creation gates confirm on a valid effective Handle; re-customize (read-only Handle) is always
	// confirmable — only Cosmetics change.
	get confirmable(): boolean {
		return this.editableHandle
			? handleConfirmable(this.handleText, this.placeholder)
			: true;
	}

	// Re-seed to the Avatar's CURRENT Cosmetics before reopening (#305): each `[c]` press must start
	// from what the Player looks like NOW, which may have changed since the last edit.
	reopen(cosmetics: Cosmetics): void {
		this.state = initCustomize(cosmetics);
		this.errorText = '';
		this.busy = false;
		this.refresh();
	}

	show(): void {
		this.container.visible = true;
		// Creation opens with the name row focused so the Player can type immediately; re-customize
		// leaves the field blurred, starting on the first cosmetic (#315).
		this.syncFieldFocus();
	}

	hide(): void {
		this.container.visible = false;
	}

	// Freeze/unfreeze input while a `createAvatar` is in flight. Blur the field while frozen so a
	// stray keystroke can't reach the focused input directly (it bypasses key()'s busy guard);
	// restore focus on unfreeze.
	setBusy(busy: boolean): void {
		this.busy = busy;
		if (busy) this.handleInput.blur();
		else this.syncFieldFocus();
		this.refresh();
	}

	// Surface a `createRejected` inline and re-open the field for another try (#304): unfreeze and
	// return focus to the name row so the Player can edit + resend.
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

	// Feed one key from the app's global handler (which dispatches BEFORE the focused input — chat's
	// ordering). Returns the confirmed result on a valid Enter, else null. ↑/↓ move ladder focus and
	// Enter confirms, both swallowed so the focused field never also sees them; on the name row every
	// other key is LEFT for the focused InputRenderable (#315); on a cosmetic row left/right cycle it.
	key(k: CreatorKey): CreatorResult | null {
		if (this.busy) return null;
		const { name } = k;
		// ↑/↓ move ladder focus; swallow them so they escape the field (otherwise inert there) and
		// reposition focus instead.
		if (name === 'up' || name === 'down') {
			this.moveFocus(name === 'down' ? 1 : -1);
			k.preventDefault?.();
			return null;
		}
		if (name === 'return') {
			if (!this.confirmable) return null; // confirm stays blocked; no-op
			k.preventDefault?.(); // don't let the focused field also fire its own submit
			return {
				// A read-only name confirms with the durable value (held in the placeholder), so
				// re-customize never mutates the Handle — only `cosmetics`.
				handle: this.editableHandle
					? effectiveHandle(this.handleText, this.placeholder)
					: this.placeholder,
				cosmetics: this.state.cosmetics,
			};
		}
		// On the name row the focused InputRenderable owns typing, backspace, and cursor — do nothing
		// here (and don't swallow) so the key reaches the field, whose INPUT event syncs the draft.
		if (this.nameFocused) return null;
		// A cosmetic row (or re-customize's read-only mode): left/right cycle the focused cosmetic.
		const { state } = reduceCustomize(this.state, name);
		this.state = state;
		this.refresh();
		return null;
	}

	// Step focus by ±1 through the ladder and reconcile the field's focus. In creation the ladder is
	// [name, ...cosmetics], wrapping; row 0 focuses the name input, any other blurs it. Re-customize
	// has no name row, so this is just the cosmetic picker's up/down (#305).
	private moveFocus(delta: number): void {
		if (!this.editableHandle) {
			this.state = reduceCustomize(this.state, delta > 0 ? 'down' : 'up').state;
			this.refresh();
			return;
		}
		const ladderLen = CUSTOMIZE_FIELDS.length + 1; // the name row + each cosmetic row
		const pos = this.nameRowFocused ? 0 : this.state.field + 1;
		const next = (((pos + delta) % ladderLen) + ladderLen) % ladderLen;
		this.nameRowFocused = next === 0;
		if (next !== 0) this.state = { ...this.state, field: next - 1 };
		this.syncFieldFocus();
		this.refresh();
	}

	private refresh(): void {
		// The nameplate previews the effective name live, so the Player sees exactly what floats under
		// their Avatar in-world.
		this.preview.avatar = previewAvatar(
			this.state.cosmetics,
			effectiveHandle(this.handleText, this.placeholder),
		);
		// Only creation mounts the name row + its hint line, so refresh their content only there; in
		// re-customize `nameFocused` is already false, so the cosmetic caret shows normally.
		const focused = this.nameFocused;
		if (this.editableHandle) {
			// The focused input owns its value (typing flows through it), so the creator never overwrites
			// it here. Labelled "name" though the domain term stays Handle.
			this.namePrompt.content = `${focused ? '▸' : ' '} name ▸ `;
			// The transient line carries a server rejection in warn colour while one stands; otherwise a
			// blank reserved row (no persistent rule hint, #315).
			if (this.errorText) {
				this.hint.content = this.errorText;
				this.hint.fg = COLORS.warn;
			} else {
				this.hint.content = ' '; // reserved blank row, no layout jump
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
