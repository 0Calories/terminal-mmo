// The pre-spawn character-customization screen (#36, PRD story 7; ADR 0005). Shown
// once at launch before the networked connect: the Player cycles body hue / hat /
// nameplate colour and watches a live Avatar Sprite preview, then confirms to enter
// the World with that look (it rides the connect handshake, #35).
//
// This is the RETAINED-UI shell (Yoga-laid-out box + text, no hand-painted x/y) plus
// one small imperative preview node — the same imperative-inside-renderSelf seam the
// playfield uses (ADR 0005). The picker LOGIC is the pure, tested customize.ts; this
// file is rendering only and is validated by eye (rendering isn't unit-tested, PRD).
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

// The subset of an OpenTUI key event the creator reads: the key `name` (arrows / return /
// backspace) plus the modifier flags, and `preventDefault` to swallow a key so the focused
// name input doesn't ALSO see it (↑/↓ move focus, ↵ confirms — neither should reach the field).
// Typed structurally so this module doesn't depend on an un-exported opentui key type; the
// real KeyEvent index.ts feeds in satisfies it. `sequence` is retained for callers that build
// keys structurally (tests) even though typing now flows through the focused input itself.
export interface CreatorKey {
	name: string;
	sequence: string;
	ctrl: boolean;
	meta: boolean;
	preventDefault?: () => void;
}

// The finalised creator choice handed back on confirm (#304): the Player-typed (or placeholder)
// Handle plus the chosen Cosmetics. index.ts sends both in `createAvatar`.
export interface CreatorResult {
	handle: string;
	cosmetics: Cosmetics;
}

// Same colour binding the playfield uses, so the preview Avatar renders identically
// to how it ships in-world (one shared source, can't drift — #56).
const STYLE: RenderStyle<RGBA> = buildSceneStyle((r, g, b, a) =>
	RGBA.fromInts(r, g, b, a),
);

// Preview geometry, derived from the real Sprite / hat catalog so it always frames
// the whole Avatar. Top to bottom the drawn stack is hat (0–MAX_HAT_H rows) + Sprite
// + nameplate (NAMEPLATE_H rows below the feet — #103), with a row of padding above
// and below; the canvas is sized for the tallest possible stack so no selection ever
// clips.
export const PLAYER = spriteFor('player');
// The nameplate is a single row of the handle below the feet (drawNameplates, ADR 0023),
// with one extra row of slack for a form's baseline offset so it never clips.
export const NAMEPLATE_H = 2;
const MAX_HAT_H = Math.max(0, ...HATS.map((h) => h.sprite?.h ?? 0));
export const VPAD = 1;
const PREVIEW_W = PLAYER.w + 12; // Sprite plus room for a short handle either side
export const PREVIEW_H = MAX_HAT_H + PLAYER.h + NAMEPLATE_H + 2 * VPAD;

// A still Avatar for the preview: facing right, full health (no hurt flash), carrying
// the in-progress cosmetics + handle so the body hue, hat, AND nameplate colour all
// preview. The Sprite is ANCHORED at a fixed vertical position — VPAD plus reserved
// headroom for the tallest possible hat — so cycling hats only moves the headwear
// above the head, never the body/feet (#104). Room is reserved below for the
// nameplate (#103). x/y are the inverse of drawEntitySprite's placement, so the
// resolved Sprite lands where intended.
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

// A live node that draws the preview Avatar through the shared renderer's full path
// (renderZoneScene -> Sprite + hat, then the drawNameplates top layer -> handle), so
// the preview is exactly what ships in-world. `live` so it redraws every frame;
// `avatar` is swapped on each picker change.
class PreviewRenderable extends Renderable {
	avatar: Entity = previewAvatar({ hue: 0, hat: 0, nameplate: 0, form: 0 }, '');

	constructor(ctx: RenderContext, options: RenderableOptions = {}) {
		// `buffered` gives this node its OWN frame buffer: renderSelf draws into it at
		// local 0,0 and opentui composites it at the node's laid-out position inside the
		// panel. Without it, renderSelf would draw onto the root buffer at absolute 0,0
		// (top-left of the screen) and renderZoneScene's clear would wipe everything.
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
		// Nameplates are a caller-composited top layer now (ADR 0023), so renderZoneScene
		// no longer draws them; add the pass here so the chosen handle previews above the
		// Avatar. Unlike the playfield this SHOWS the self plate, since it's a preview.
		drawNameplates(buffer, [this.avatar], { x: 0, y: 0 }, terrain, STYLE);
	}
}

// The customization screen. Mirrors the Shop's structure (a full-screen container +
// a centred bordered panel) and key-routing contract: index.ts feeds keys to `key()`,
// which returns the chosen Cosmetics on Enter (and otherwise null), refreshing the
// preview + rows itself.
export class CharacterCreator {
	private readonly container: BoxRenderable;
	private readonly preview: PreviewRenderable;
	private readonly handleInput: InputRenderable;
	private readonly namePrompt: TextRenderable;
	private readonly hint: TextRenderable;
	private readonly footer: TextRenderable;
	private readonly rows: TextRenderable;
	private state: CustomizeState;
	// The auto-derived Handle (from $USER / MMO_HANDLE): shown as the field placeholder and used
	// verbatim when the Player leaves the field empty (#304).
	private readonly placeholder: string;
	// The Player-typed name draft, kept in sync with the focused InputRenderable's value via its
	// per-keystroke INPUT event (the input owns the text now; the creator no longer hand-drives
	// it — #315). Empty ⇒ the placeholder is used on confirm.
	private handleText = '';
	// Whether the name row (row 0 of the ladder) currently owns focus, in editable/creation mode.
	// When true the InputRenderable is `.focus()`'d and owns typing + left/right cursor; ↑/↓ move
	// focus off it onto a cosmetic row. Meaningless in re-customize mode (no name row — #315).
	private nameRowFocused = false;
	// A server-side `createRejected` message (taken / invalid), surfaced in a transient warn line;
	// cleared as soon as the Player edits the name again.
	private errorText = '';
	// True between sending `createAvatar` and the server's verdict: input is frozen so the draft
	// can't change mid round-trip. Cleared on a rejection so the Player can retry.
	private busy = false;
	// Whether the Handle field is editable. Creation mode (#304) lets the Player type it; the
	// in-game re-customize mode (#305, [c] in Town — ADR 0028) reopens the SAME creator with the
	// Handle set-once and read-only, editing Cosmetics only. When false the field shows the
	// durable Handle verbatim, typing/backspace are inert, and confirm is always allowed.
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
		// Creation opens with the name row (row 0 of the ladder) focused; re-customize has no name
		// row and opens on the first cosmetic row (#315). The actual `.focus()` fires in show().
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
		// The name field: a `name ▸` prompt (a leading caret marks it as the focused ladder row)
		// beside the shared InputRenderable — the same widget the chat line wraps. On the name row
		// this input is genuinely `.focus()`'d and owns typing + left/right cursor (#315); the
		// creator no longer hand-drives its value. Labelled "name" though the domain term stays
		// Handle. maxLength mirrors the Handle rule; live charset filtering happens in the INPUT
		// listener below.
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
		// Live-filter + live preview on every keystroke into the focused field: the input hands us
		// its whole value, we strip anything outside the shared Handle charset (length is already
		// capped by maxLength), clear any standing server rejection, and refresh so the preview
		// nameplate tracks what's typed. Re-assigning `value` when the filter changed it re-fires
		// INPUT, but the next pass is already clean so it settles at once. Read-only mode never
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
		// A transient line below the field: blank by default (its row reserved so nothing jumps),
		// carrying a server rejection in warn colour only while one stands (#315). In re-customize
		// mode it still notes the set-once Handle (#305; #318 owns removing that).
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
		panel.add(handleRow);
		panel.add(this.hint);
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

	// The current inline error text ('' when none) — exposed so a test can assert a
	// `createRejected` surfaced without a renderer.
	get errorMessage(): string {
		return this.errorText;
	}

	// Which ladder row currently has focus: 'name' when the name field owns typing, else the
	// focused cosmetic's key ('hue' / 'hat' / 'nameplate'). Exposed so a headless test can assert
	// ↑/↓ ladder navigation on the public surface rather than reaching into private focus state.
	get focusedRow(): string {
		if (this.nameFocused) return 'name';
		return CUSTOMIZE_FIELDS[this.state.field]?.key ?? '';
	}

	// The name that would actually be submitted right now (the typed draft, or the placeholder when
	// empty). Exposed so a test can assert that an illegal keystroke left the effective name
	// unchanged without inspecting the raw input value.
	get effectiveName(): string {
		return effectiveHandle(this.handleText, this.placeholder);
	}

	// True while the name field (row 0 of the ladder) is the focused row and thus owns typing — the
	// one predicate the focus/caret logic keys off. Only meaningful in editable/creation mode; the
	// read-only re-customize field is never a focusable ladder row.
	private get nameFocused(): boolean {
		return this.editableHandle && this.nameRowFocused;
	}

	// Reconcile the InputRenderable's OS-level focus with the ladder: the field owns the keyboard
	// exactly while the name row is focused, so keystrokes reach it only then.
	private syncFieldFocus(): void {
		if (this.nameFocused) this.handleInput.focus();
		else this.handleInput.blur();
	}

	// Whether the confirm key is currently accepted. Creation gates on a valid effective Handle;
	// re-customize (read-only Handle) is always confirmable — the durable Handle is already valid
	// and only Cosmetics change.
	get confirmable(): boolean {
		return this.editableHandle
			? handleConfirmable(this.handleText, this.placeholder)
			: true;
	}

	// Re-seed the re-customize creator to the Avatar's CURRENT Cosmetics before reopening it
	// (#305): each `[c]` press must start from what the Player looks like NOW, which may have
	// changed since the last edit. Clears any transient busy/error and refreshes the preview.
	// Only meaningful in read-only-Handle mode (the durable Handle never changes).
	reopen(cosmetics: Cosmetics): void {
		this.state = initCustomize(cosmetics);
		this.errorText = '';
		this.busy = false;
		this.refresh();
	}

	show(): void {
		this.container.visible = true;
		// Creation opens with the name row focused so the Player can type immediately; re-customize
		// has no name row and leaves the field blurred, starting on the first cosmetic (#315).
		this.syncFieldFocus();
	}

	hide(): void {
		this.container.visible = false;
	}

	// Freeze/unfreeze input while a `createAvatar` is in flight, so the draft can't change between
	// send and the server's verdict. Blur the field while frozen so a stray keystroke can't reach
	// the focused input directly (it bypasses the busy guard in key()); restore focus on unfreeze.
	setBusy(busy: boolean): void {
		this.busy = busy;
		if (busy) this.handleInput.blur();
		else this.syncFieldFocus();
		this.refresh();
	}

	// Surface a server `createRejected` in the transient warn line and re-open the field for another
	// try (#304): the creator stays visible, shows why in "name" copy (#315), unfreezes, and returns
	// focus to the name row so the Player can edit + resend at once.
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

	// Feed one key from the app's global keypress handler (which dispatches BEFORE the focused
	// input's own subscription — chat's ordering, message-log.ts). Returns the confirmed
	// { handle, cosmetics } on a valid Enter, else null:
	// - ↑/↓ move focus through the ladder (name → cosmetics), swallowed so the focused field never
	//   sees them;
	// - Enter confirms ONLY when the effective name is valid (swallowed so the field can't also
	//   submit); otherwise it's a no-op;
	// - on the name row every other key (printable / backspace / left / right) is LEFT for the
	//   focused InputRenderable to handle — the creator no longer hand-drives the value (#315);
	// - on a cosmetic row (or in read-only re-customize mode) left/right cycle the focused cosmetic.
	key(k: CreatorKey): CreatorResult | null {
		if (this.busy) return null;
		const { name } = k;
		// ↑/↓ move focus through the ladder. Intercept + swallow them so they escape the field
		// (they'd otherwise be inert single-line-input keys) and reposition focus instead.
		if (name === 'up' || name === 'down') {
			this.moveFocus(name === 'down' ? 1 : -1);
			k.preventDefault?.();
			return null;
		}
		if (name === 'return') {
			if (!this.confirmable) return null; // confirm stays blocked; no-op
			k.preventDefault?.(); // don't let the focused field also fire its own submit
			return {
				// A read-only name confirms with the durable value (the placeholder holds it), so
				// re-customize never mutates the Handle — only `cosmetics` is acted on downstream.
				handle: this.editableHandle
					? effectiveHandle(this.handleText, this.placeholder)
					: this.placeholder,
				cosmetics: this.state.cosmetics,
			};
		}
		// On the name row the focused InputRenderable owns typing, backspace, and left/right cursor
		// movement — do nothing here (and don't swallow the key) so it reaches the field, whose
		// INPUT event syncs the draft + live preview.
		if (this.nameFocused) return null;
		// A cosmetic row (or re-customize's read-only-name mode): left/right cycle the focused
		// cosmetic; anything else is a no-op.
		const { state } = reduceCustomize(this.state, name);
		this.state = state;
		this.refresh();
		return null;
	}

	// Step focus by ±1 through the ladder and reconcile the field's focus with it. In editable mode
	// the ladder is [name, ...cosmetics], wrapping end-to-end; landing on row 0 focuses the name
	// input, any other row blurs it and focuses that cosmetic. In read-only re-customize mode there
	// is no name row, so this is just the cosmetic picker's up/down (unchanged #305 behaviour).
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
		// The nameplate previews the effective name live, so the Player sees exactly what will
		// float under their Avatar in-world.
		this.preview.avatar = previewAvatar(
			this.state.cosmetics,
			effectiveHandle(this.handleText, this.placeholder),
		);
		// The focused input owns its own value in creation mode (typing flows through it), so the
		// creator never overwrites it here. Re-customize's read-only field just shows the durable
		// name verbatim.
		if (!this.editableHandle) this.handleInput.value = this.placeholder;
		// The name row is the focused ladder row when the field owns focus; while it does, no
		// cosmetic row shows the caret. Creation labels the field "name" (#315); the read-only
		// re-customize field keeps its "handle" label untouched (#318 owns that mode's copy).
		const focused = this.nameFocused;
		const label = this.editableHandle ? 'name' : 'handle';
		this.namePrompt.content = `${focused ? '▸' : ' '} ${label} ▸ `;
		const lines = customizeRows(this.state).map((r) => {
			const caret = r.focused && !focused ? '▸' : ' ';
			return `${caret} ${r.label.padEnd(10)} ◂ ${r.value} ▸`;
		});
		this.rows.content = `\n${lines.join('\n')}\n`;
		// The transient line carries a server rejection in warn colour while one stands; otherwise
		// it is a blank reserved row (creation — no persistent rule hint, #315) or the set-once note
		// (re-customize, #305; #318 owns removing it). The footer gates the "enter the World"
		// affordance on a valid draft.
		if (this.errorText) {
			this.hint.content = this.errorText;
			this.hint.fg = COLORS.warn;
		} else if (!this.editableHandle) {
			this.hint.content = 'handle is set for life';
			this.hint.fg = COLORS.dim;
		} else {
			this.hint.content = ' '; // reserved blank row, no layout jump
			this.hint.fg = COLORS.dim;
		}
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
