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
	type OptimizedBuffer,
	Renderable,
	type RenderableOptions,
	type Renderable as RenderableType,
	type RenderContext,
	RGBA,
	TextRenderable,
} from '@opentui/core';
import {
	type CustomizeState,
	customizeRows,
	effectiveHandle,
	HANDLE_MAX_LEN,
	handleConfirmable,
	initCustomize,
	reduceCustomize,
	typeHandleChar,
} from './customize';
import { COLORS } from './theme';

// The subset of an OpenTUI key event the creator reads: the key `name` (arrows / return /
// backspace) and the raw `sequence` (the printable character, for typing the Handle). Typed
// structurally so this module doesn't depend on an un-exported opentui key type.
export interface CreatorKey {
	name: string;
	sequence: string;
	ctrl: boolean;
	meta: boolean;
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
	private readonly hint: TextRenderable;
	private readonly footer: TextRenderable;
	private readonly rows: TextRenderable;
	private state: CustomizeState;
	// The auto-derived Handle (from $USER / MMO_HANDLE): shown as the field placeholder and used
	// verbatim when the Player leaves the field empty (#304).
	private readonly placeholder: string;
	// The Player-typed Handle draft; empty ⇒ the placeholder is used on confirm.
	private handleText = '';
	// A server-side `createRejected` message (taken / invalid), surfaced inline; cleared as soon
	// as the Player edits the Handle again.
	private errorText = '';
	// True between sending `createAvatar` and the server's verdict: input is frozen so the draft
	// can't change mid round-trip. Cleared on a rejection so the Player can retry.
	private busy = false;

	constructor(ctx: RenderContext, handle: string, start: Cosmetics) {
		this.placeholder = handle;
		this.state = initCustomize(start);

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
			title: ' Create your Avatar ',
			titleColor: COLORS.vendor,
			backgroundColor: COLORS.hudBg,
		});

		this.preview = new PreviewRenderable(ctx, {
			width: PREVIEW_W,
			height: PREVIEW_H,
		});
		// The editable Handle field: a dim `handle ▸` prompt beside the shared InputRenderable
		// (the same widget the chat line wraps). It is NOT focused — the creator owns the keyboard
		// and drives the value via `refresh()` — so it renders as a static field showing the typed
		// draft, or the auto-derived placeholder when empty (#304). maxLength mirrors the Handle rule.
		const handleRow = new BoxRenderable(ctx, {
			flexDirection: 'row',
			alignItems: 'center',
			width: 36,
			backgroundColor: COLORS.hudBg,
		});
		handleRow.add(
			new TextRenderable(ctx, {
				content: 'handle ▸ ',
				fg: COLORS.dim,
				bg: COLORS.hudBg,
			}),
		);
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
		handleRow.add(this.handleInput);
		// The validation hint / inline server error, below the field.
		this.hint = new TextRenderable(ctx, {
			content: '',
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

	// Whether the confirm key is currently accepted (the effective Handle is valid).
	get confirmable(): boolean {
		return handleConfirmable(this.handleText, this.placeholder);
	}

	show(): void {
		this.container.visible = true;
	}

	hide(): void {
		this.container.visible = false;
	}

	// Freeze/unfreeze input while a `createAvatar` is in flight, so the draft can't change
	// between send and the server's verdict.
	setBusy(busy: boolean): void {
		this.busy = busy;
		this.refresh();
	}

	// Surface a server `createRejected` inline and re-open the field for another try (#304): the
	// creator stays visible, shows why, and unfreezes so the Player can edit + resend.
	showRejection(reason: 'taken' | 'invalid'): void {
		this.busy = false;
		this.errorText =
			reason === 'taken'
				? "That handle's taken — try another."
				: 'Invalid handle — 2–16 of letters, digits, - or _.';
		this.refresh();
	}

	// Feed one key. Returns the confirmed { handle, cosmetics } on a valid Enter, else null:
	// - a legal printable char / backspace edits the Handle draft (clearing any prior error),
	// - arrows drive the cosmetic picker,
	// - Enter confirms ONLY when the effective Handle is valid (otherwise it's a no-op + hint).
	// Refreshes the preview + field rows after every change so the screen tracks the selection.
	key(k: CreatorKey): CreatorResult | null {
		if (this.busy) return null;
		const { name, sequence } = k;
		if (name === 'backspace') {
			if (this.handleText) {
				this.handleText = this.handleText.slice(0, -1);
				this.errorText = '';
				this.refresh();
			}
			return null;
		}
		// A printable, claimable character types into the Handle (ctrl/meta chords are commands,
		// not text). Typing supersedes the cosmetic picker's left/right so the two never fight.
		if (!k.ctrl && !k.meta && sequence) {
			const next = typeHandleChar(this.handleText, sequence);
			if (next !== this.handleText) {
				this.handleText = next;
				this.errorText = '';
				this.refresh();
				return null;
			}
		}
		if (name === 'return') {
			if (!this.confirmable) {
				this.refresh(); // keep the hint up; confirm stays blocked
				return null;
			}
			return {
				handle: effectiveHandle(this.handleText, this.placeholder),
				cosmetics: this.state.cosmetics,
			};
		}
		// Anything else (the arrows) drives the cosmetic picker.
		const { state } = reduceCustomize(this.state, name);
		this.state = state;
		this.refresh();
		return null;
	}

	private refresh(): void {
		// The nameplate previews the effective Handle live, so the Player sees exactly what will
		// float under their Avatar in-world.
		this.preview.avatar = previewAvatar(
			this.state.cosmetics,
			effectiveHandle(this.handleText, this.placeholder),
		);
		this.handleInput.value = this.handleText;
		const lines = customizeRows(this.state).map((r) => {
			const caret = r.focused ? '▸' : ' ';
			return `${caret} ${r.label.padEnd(10)} ◂ ${r.value} ▸`;
		});
		this.rows.content = `\n${lines.join('\n')}\n`;
		// The hint prefers a server error, then the validity rule, then blank; the footer drops
		// the "enter the World" affordance until confirm is actually accepted.
		if (this.errorText) {
			this.hint.content = this.errorText;
			this.hint.fg = COLORS.warn;
		} else if (!this.confirmable) {
			this.hint.content = 'handle: 2–16 of letters, digits, - or _';
			this.hint.fg = COLORS.dim;
		} else {
			this.hint.content = '';
			this.hint.fg = COLORS.dim;
		}
		this.footer.content = this.busy
			? 'creating…'
			: this.confirmable
				? 'type a handle   ↑/↓ field   ←/→ change   ↵ enter the World'
				: 'type a handle   ↑/↓ field   ←/→ change';
	}
}
