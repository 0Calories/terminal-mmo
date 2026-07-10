// Pure presentation helpers for the Sprite editor TUI (ADR 0031). No I/O and no
// `@opentui/core` import lives here — the `tui.ts` glue wires these to a screen
// buffer and keyboard. Everything is a deterministic function over the pure
// editor state so it is unit-testable headlessly, exactly like the zone editor's
// `editor.ts` helpers.
import type { RGBAQuad } from '@mmo/core';
import type { DynamicPreviews } from './state';
import type { SpriteRole } from './templates';

// ---------------------------------------------------------------------------
// Roles ⇄ on-disk directories (sprites/<dir>/<id>.sprite)
// ---------------------------------------------------------------------------

// The `sprites/` sub-directory each role's files live under (ADR 0031: directory
// = role, filename = id).
const ROLE_DIRS: Record<SpriteRole, string> = {
	form: 'forms',
	weapon: 'weapons',
	hat: 'hats',
	monster: 'monsters',
	npc: 'npcs',
};

const DIR_ROLES: Record<string, SpriteRole> = Object.fromEntries(
	Object.entries(ROLE_DIRS).map(([role, dir]) => [dir, role as SpriteRole]),
) as Record<string, SpriteRole>;

export function dirForRole(role: SpriteRole): string {
	return ROLE_DIRS[role];
}

export function roleForDir(dir: string): SpriteRole | undefined {
	return DIR_ROLES[dir];
}

export interface EditTarget {
	// The bare sprite id (filename without extension).
	id: string;
	// The role, resolved from a `<dir>/<id>` prefix; undefined for a bare id.
	role?: SpriteRole;
}

// Parse the `forge sprite edit <arg>` argument. `forms/buddy` → {id:'buddy',
// role:'form'}; a bare `buddy` → {id:'buddy'} (the caller searches for it, and if
// missing cannot know which template to use — a role is required to create).
export function parseEditArg(arg: string): EditTarget | undefined {
	if (!arg) return undefined;
	const clean = arg.replace(/\.sprite$/, '');
	const slash = clean.lastIndexOf('/');
	if (slash < 0) return { id: clean };
	const dir = clean.slice(0, slash);
	const id = clean.slice(slash + 1);
	if (!id) return undefined;
	// Take the last path segment as the role dir (handles `sprites/forms/buddy`).
	const dirSeg = dir.slice(dir.lastIndexOf('/') + 1);
	return { id, role: roleForDir(dirSeg) };
}

// ---------------------------------------------------------------------------
// Representative dynamic-channel preview colors
// ---------------------------------------------------------------------------

// The p/a dynamic recolor channels have no fixed color in a file — the game
// assigns them at render time. The editor previews them with representative
// RGBAs so painted `p`/`a` cells look plausible: a mid player hue, a bright
// weapon accent. Passed everywhere the editor resolves colors.
export const SPRITE_PREVIEWS: DynamicPreviews = {
	p: [255, 150, 40, 255],
	a: [120, 200, 255, 255],
};

// ---------------------------------------------------------------------------
// Color-key resolution
// ---------------------------------------------------------------------------

// Resolve a color key to its RGBA the way the game would: '' is transparent
// (null); the reserved dynamic keys resolve to their preview colors; otherwise a
// file-local color wins over the global scene palette. Unknown keys → null so
// the caller can fall back to a default ink.
export function resolveColorKey(
	key: string,
	local: Readonly<Record<string, RGBAQuad>>,
	global: Readonly<Record<string, RGBAQuad>>,
	previews: DynamicPreviews,
): RGBAQuad | null {
	if (key === '' || key === ' ') return null;
	if (key === 'p') return previews.p;
	if (key === 'a') return previews.a;
	return local[key] ?? global[key] ?? null;
}

// ---------------------------------------------------------------------------
// Viewport scrolling (in cell coordinates)
// ---------------------------------------------------------------------------

// Keep `cursor` within `viewLen`, leaving a `scrolloff` margin where possible.
// Mirrors the zone editor's scrollAxis (deliberately duplicated to keep this
// module free of zone dependencies).
export function scrollAxis(
	cam: number,
	cursor: number,
	viewLen: number,
	scrolloff: number,
): number {
	const off = Math.min(scrolloff, Math.floor((viewLen - 1) / 2));
	const lo = cam + off;
	const hi = cam + viewLen - 1 - off;
	let next = cam;
	if (cursor < lo) next = cursor - off;
	else if (cursor > hi) next = cursor - viewLen + 1 + off;
	return Math.max(0, next);
}

export interface Cam {
	x: number;
	y: number;
}

export function scrollViewport(
	cam: Cam,
	cursorCell: { x: number; y: number },
	viewW: number,
	viewH: number,
	scrolloff: number,
): Cam {
	return {
		x: scrollAxis(cam.x, cursorCell.x, viewW, scrolloff),
		y: scrollAxis(cam.y, cursorCell.y, viewH, scrolloff),
	};
}

// ---------------------------------------------------------------------------
// Cursor quadrant marker
// ---------------------------------------------------------------------------

// The single-quadrant block glyph for a cursor bit (0..3), used to show WHICH
// sub-pixel of the highlighted cell the pixel cursor sits on: ▘ TL, ▝ TR, ▖ BL,
// ▗ BR.
const QUADRANT_MARKERS = ['▘', '▝', '▖', '▗'] as const;

export function quadrantMarker(bit: number): string {
	return QUADRANT_MARKERS[bit] ?? '▘';
}

// ---------------------------------------------------------------------------
// Status + help chrome
// ---------------------------------------------------------------------------

export interface SpriteStatusModel {
	id: string;
	role: SpriteRole;
	frame: string;
	frameIdx: number;
	frameCount: number;
	tool: string;
	fgKey: string;
	bgKey: string | null;
	cell: { x: number; y: number };
	bit: number;
	dirty: boolean;
}

const BIT_NAMES = ['TL', 'TR', 'BL', 'BR'] as const;

export function bitName(bit: number): string {
	return BIT_NAMES[bit] ?? '?';
}

// The persistent status line (feedback + save diagnostics are drawn separately,
// styled to stand out).
export function spriteStatusLine(m: SpriteStatusModel): string {
	const bg = m.bgKey === null ? 'none' : m.bgKey;
	const dirty = m.dirty ? ' *' : '';
	return `${m.id} (${m.role})${dirty} · frame ${m.frame} [${m.frameIdx + 1}/${m.frameCount}] · ${m.tool} · fg ${m.fgKey} · bg ${bg} · cell (${m.cell.x},${m.cell.y}) ${bitName(m.bit)}`;
}

export interface KeyHint {
	keys: string;
	label: string;
}

// The canonical keybinding table — the single source for the help line and the
// documentation of the editor's controls.
export const SPRITE_KEY_HINTS: readonly KeyHint[] = [
	{ keys: 'hjkl', label: 'move' },
	{ keys: 'space', label: 'paint' },
	{ keys: 'p/e/s', label: 'tools' },
	{ keys: 'f/g', label: 'color' },
	{ keys: 'c', label: 'clear' },
	{ keys: '[ ]', label: 'frame' },
	{ keys: 'u/^r', label: 'undo' },
	{ keys: '^s', label: 'save' },
	{ keys: 'q', label: 'quit' },
];

export function spriteHelpLine(): string {
	return SPRITE_KEY_HINTS.map((h) => `${h.keys} ${h.label}`).join(' · ');
}

// A short summary of save diagnostics for the inline status area.
export function saveDiagSummary(
	diags: { severity: string; message: string }[],
): string {
	if (diags.length === 0) return '✓ saved — no issues';
	const errors = diags.filter((d) => d.severity === 'error').length;
	const warnings = diags.length - errors;
	const parts: string[] = [];
	if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
	if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
	return `saved · ${parts.join(' · ')}: ${diags[0].message}`;
}
