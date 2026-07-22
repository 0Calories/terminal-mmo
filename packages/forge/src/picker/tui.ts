import { existsSync } from 'node:fs';
import { listZoneIds, readSpriteSourcesFromDir } from '@mmo/assets';
import type { OptimizedBuffer, RenderContext } from '@opentui/core';
import { Renderable, RGBA } from '@opentui/core';
import type { CliDeps } from '../cli';
import { runEdit } from '../editor';
import type { SpriteRole } from '../sprite-editor/templates';
import { runSpriteEdit } from '../sprite-editor/tui';
import { dirForRole, roleForDir } from '../sprite-editor/view';
import {
	type AssetInventory,
	type AssetKind,
	backspaceQuery,
	beginNewSprite,
	cancelNewSprite,
	commitNewSprite,
	type LaunchTarget,
	moveCursor,
	newSpriteBackspaceId,
	newSpriteChooseRole,
	newSpriteError,
	newSpriteMoveRole,
	newSpriteRole,
	newSpriteTypeId,
	openPicker,
	PICKER_ROLES,
	type PickerState,
	pickerLaunch,
	pickerSections,
	typeQuery,
	visibleEntries,
} from './model';

export interface PickerKey {
	name: string;
	sequence?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}

export interface PickerMouse {
	button: number;
	x: number;
	y: number;
}

const MIN_W = 48;
const MIN_H = 12;

const HEADER_ROWS = 3;
const FOOTER_ROWS = 1;

export interface PickerOpts {
	inventory: AssetInventory;
	filterKind: AssetKind | null;

	onLaunch: (target: LaunchTarget) => void;
	onQuit: () => void;
}

function titleFor(kind: AssetKind | null): string {
	if (kind === 'sprite') return 'forge · pick a sprite';
	if (kind === 'zone') return 'forge · pick a zone';
	return 'forge · pick an asset';
}

export class AssetPicker extends Renderable {
	state: PickerState;
	private readonly onLaunch: (target: LaunchTarget) => void;
	private readonly onQuit: () => void;

	private scroll = 0;

	private rowHits: { y: number; index: number }[] = [];

	// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
	constructor(ctx: RenderContext | any, opts: PickerOpts) {
		super(ctx, { width: '100%', height: '100%', live: true });
		this.state = openPicker(opts.inventory, opts.filterKind);
		this.onLaunch = opts.onLaunch;
		this.onQuit = opts.onQuit;
		this.onMouseDown = (e) => this.mouseDown(e);
	}

	attach(root: { add: (r: Renderable) => void }): void {
		root.add(this);
	}

	key(k: PickerKey): void {
		if (this.state.newSprite) {
			this.newSpriteKey(k);
			return;
		}
		switch (k.name) {
			case 'up':
				this.state = moveCursor(this.state, -1);
				return;
			case 'down':
				this.state = moveCursor(this.state, 1);
				return;
			case 'return':
			case 'enter': {
				const target = pickerLaunch(this.state);
				if (target) this.onLaunch(target);
				return;
			}
			case 'escape':
				this.onQuit();
				return;
			case 'backspace':
				this.state = backspaceQuery(this.state);
				return;
		}

		if (k.name === 'n' && !k.ctrl && !k.meta) {
			this.state = beginNewSprite(this.state);
			return;
		}

		const ch = k.sequence ?? '';
		if (ch.length === 1 && ch >= ' ' && ch !== ' ') {
			this.state = typeQuery(this.state, ch);
		}
	}

	private newSpriteKey(k: PickerKey): void {
		const phase = this.state.newSprite?.phase;
		if (k.name === 'escape') {
			this.state = cancelNewSprite(this.state);
			return;
		}
		if (phase === 'role') {
			switch (k.name) {
				case 'up':
				case 'left':
					this.state = newSpriteMoveRole(this.state, -1);
					return;
				case 'down':
				case 'right':
					this.state = newSpriteMoveRole(this.state, 1);
					return;
				case 'return':
				case 'enter':
					this.state = newSpriteChooseRole(this.state);
					return;
			}
			return;
		}

		if (k.name === 'return' || k.name === 'enter') {
			const target = commitNewSprite(this.state);
			if (target) this.onLaunch(target);
			return;
		}
		if (k.name === 'backspace') {
			this.state = newSpriteBackspaceId(this.state);
			return;
		}
		const ch = k.sequence ?? '';
		if (ch.length === 1) this.state = newSpriteTypeId(this.state, ch);
	}

	private mouseDown(e: PickerMouse): void {
		if (this.state.newSprite || e.button !== 0) return;
		const hit = this.rowHits.find((h) => h.y === e.y);
		if (!hit) return;
		this.state = { ...this.state, cursor: hit.index };
		const target = pickerLaunch(this.state);
		if (target) this.onLaunch(target);
	}

	protected renderSelf(buf: OptimizedBuffer): void {
		const W = buf.width;
		const H = buf.height;
		const bg = RGBA.fromInts(16, 18, 26, 255);
		const chromeBg = RGBA.fromInts(22, 25, 34, 255);
		const text = RGBA.fromInts(232, 232, 238, 255);
		const dim = RGBA.fromInts(140, 148, 164, 255);
		const hot = RGBA.fromInts(245, 215, 95, 255);
		const cursorBg = RGBA.fromInts(58, 72, 104, 255);
		const warn = RGBA.fromInts(255, 180, 80, 255);
		buf.fillRect(0, 0, W, H, bg);
		this.rowHits = [];

		if (W < MIN_W || H < MIN_H) {
			const msg = `picker needs ≥${MIN_W}×${MIN_H} — now ${W}×${H}`;
			buf.drawText(
				msg.slice(0, W),
				Math.max(0, Math.floor((W - msg.length) / 2)),
				Math.floor(H / 2),
				warn,
				bg,
			);
			return;
		}

		if (this.state.newSprite) {
			this.renderNewSprite(buf, { text, dim, hot, warn, bg, chromeBg });
			return;
		}

		buf.fillRect(0, 0, W, 1, chromeBg);
		buf.drawText(
			titleFor(this.state.filterKind).slice(0, W),
			0,
			0,
			text,
			chromeBg,
		);
		const q = this.state.query;
		buf.drawText(
			(q ? `filter: ${q}` : 'type to filter').slice(0, W),
			0,
			1,
			q ? hot : dim,
			bg,
		);

		const listTop = HEADER_ROWS;
		const listH = Math.max(1, H - HEADER_ROWS - FOOTER_ROWS);
		this.renderList(buf, listTop, listH, { text, dim, hot, cursorBg, bg });

		const footRow = H - 1;
		buf.fillRect(0, footRow, W, 1, chromeBg);
		buf.drawText(
			'↑↓ navigate · enter open · n new sprite · esc quit'.slice(0, W),
			0,
			footRow,
			dim,
			chromeBg,
		);
	}

	private renderList(
		buf: OptimizedBuffer,
		top: number,
		listH: number,
		c: { text: RGBA; dim: RGBA; hot: RGBA; cursorBg: RGBA; bg: RGBA },
	): void {
		const W = buf.width;
		const sections = pickerSections(this.state);
		const visibleCount = visibleEntries(this.state).length;

		if (visibleCount === 0) {
			buf.drawText('(no matching assets)', 2, top, c.dim, c.bg);
			return;
		}

		type Row =
			| { kind: 'header'; label: string; count: number }
			| { kind: 'entry'; label: string; index: number };
		const rows: Row[] = [];
		for (const sec of sections) {
			rows.push({
				kind: 'header',
				label: sec.label,
				count: sec.entries.length,
			});
			sec.entries.forEach((entry, i) => {
				rows.push({
					kind: 'entry',
					label: entry.id,
					index: sec.startIndex + i,
				});
			});
		}

		const cursorRow = rows.findIndex(
			(r) => r.kind === 'entry' && r.index === this.state.cursor,
		);
		if (cursorRow >= 0) {
			if (cursorRow < this.scroll) this.scroll = cursorRow;
			else if (cursorRow >= this.scroll + listH)
				this.scroll = cursorRow - listH + 1;
		}
		this.scroll = Math.max(
			0,
			Math.min(this.scroll, Math.max(0, rows.length - listH)),
		);

		for (let vy = 0; vy < listH; vy++) {
			const r = rows[this.scroll + vy];
			if (!r) break;
			const y = top + vy;
			if (r.kind === 'header') {
				buf.drawText(`${r.label}  (${r.count})`.slice(0, W), 0, y, c.hot, c.bg);
				continue;
			}
			const selected = r.index === this.state.cursor;
			if (selected) buf.fillRect(0, y, W, 1, c.cursorBg);
			const marker = selected ? '▸ ' : '  ';
			buf.drawText(
				`${marker}${r.label}`.slice(0, W),
				2,
				y,
				selected ? c.text : c.dim,
				selected ? c.cursorBg : c.bg,
			);
			this.rowHits.push({ y, index: r.index });
		}
	}

	private renderNewSprite(
		buf: OptimizedBuffer,
		c: {
			text: RGBA;
			dim: RGBA;
			hot: RGBA;
			warn: RGBA;
			bg: RGBA;
			chromeBg: RGBA;
		},
	): void {
		const W = buf.width;
		const ns = this.state.newSprite;
		if (!ns) return;
		buf.fillRect(0, 0, W, 1, c.chromeBg);
		buf.drawText('new sprite'.slice(0, W), 0, 0, c.text, c.chromeBg);

		if (ns.phase === 'role') {
			buf.drawText('pick a role:', 0, 2, c.dim, c.bg);
			PICKER_ROLES.forEach((role, i) => {
				const y = 4 + i;
				const selected = i === ns.roleIndex;
				if (selected) buf.fillRect(0, y, W, 1, RGBA.fromInts(58, 72, 104, 255));
				const marker = selected ? '▸ ' : '  ';
				buf.drawText(
					`${marker}${dirForRole(role)}`.slice(0, W),
					2,
					y,
					selected ? c.text : c.dim,
					selected ? RGBA.fromInts(58, 72, 104, 255) : c.bg,
				);
			});
			buf.drawText(
				'↑↓ role · enter next · esc cancel',
				0,
				buf.height - 1,
				c.dim,
				c.bg,
			);
			return;
		}

		const role = newSpriteRole(this.state);
		buf.drawText(`role: ${role ? dirForRole(role) : ''}`, 0, 2, c.dim, c.bg);
		buf.drawText('id:', 0, 4, c.dim, c.bg);
		buf.drawText(`${ns.id}▎`, 4, 4, c.hot, c.bg);
		const err = newSpriteError(this.state);
		if (err) buf.drawText(err.slice(0, W), 0, 6, c.warn, c.bg);
		buf.drawText(
			'type an id · enter create · esc cancel',
			0,
			buf.height - 1,
			c.dim,
			c.bg,
		);
	}
}

export function readSpriteInventory(
	spritesRoot: string,
): AssetInventory['sprites'] {
	if (!existsSync(spritesRoot)) return [];
	const sprites: { role: SpriteRole; id: string }[] = [];
	for (const src of readSpriteSourcesFromDir(spritesRoot).values()) {
		const role = roleForDir(src.role);
		if (!role) continue;
		sprites.push({ role, id: src.id });
	}
	return sprites;
}

export function readInventory(
	spritesRoot: string,
	zonesRoot: string,
): AssetInventory {
	return {
		sprites: readSpriteInventory(spritesRoot),
		zones: listZoneIds(zonesRoot).map((id) => ({ id })),
	};
}

export async function runPicker(
	filterKind: AssetKind | null,
	deps: { spritesRoot: string; zonesRoot: string; log: (l: string) => void },
): Promise<void> {
	const inventory = readInventory(deps.spritesRoot, deps.zonesRoot);

	const { createCliRenderer } = await import('@opentui/core');
	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
		useKittyKeyboard: {},
	});

	const teardown = () =>
		(renderer as unknown as { destroy?: () => void }).destroy?.();

	const launch = await new Promise<LaunchTarget | null>((resolve) => {
		const picker = new AssetPicker(renderer, {
			inventory,
			filterKind,
			onLaunch: (t) => resolve(t),
			onQuit: () => resolve(null),
		});
		picker.attach(renderer.root);
		renderer.keyInput.on('keypress', (k: PickerKey) => {
			picker.key(k);
			picker.requestRender();
		});
		renderer.start();
	});

	teardown();
	if (!launch) {
		process.exit(0);
	}

	const spriteDeps: CliDeps = { root: deps.spritesRoot, log: deps.log };
	const zoneDeps: CliDeps = { root: deps.zonesRoot, log: deps.log };
	if (launch.kind === 'sprite') {
		await runSpriteEdit(
			[`${dirForRole(launch.role)}/${launch.id}`],
			spriteDeps,
		);
	} else {
		await runEdit([launch.id], zoneDeps);
	}
}
