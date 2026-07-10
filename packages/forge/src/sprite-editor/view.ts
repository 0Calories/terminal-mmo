// Pure presentation helpers for the Sprite editor TUI (ADR 0031). No I/O and no
// `@opentui/core` import lives here — the `tui.ts` glue wires these to a screen
// buffer and keyboard. Everything is a deterministic function over the pure
// editor state so it is unit-testable headlessly, exactly like the zone editor's
// `editor.ts` helpers.
import type { Facing, RGBAQuad } from '@mmo/core';
import { mirrorAnchorX } from '@mmo/core';
import { ROLE_PROFILES, type SpriteDoc, spriteFromDoc } from '@mmo/render';
import type { AnchorMarker, DynamicPreviews } from './state';
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

// ---------------------------------------------------------------------------
// Role-required-pose / anchor hints (ROLE_PROFILES is keyed by directory name)
// ---------------------------------------------------------------------------

// Required poses a doc of this role is missing — a non-blocking authoring hint,
// not a refusal (deleting a required pose is allowed, just surfaced here).
export function missingRequiredPoses(
	doc: SpriteDoc,
	role: SpriteRole,
): string[] {
	const profile = ROLE_PROFILES[dirForRole(role)];
	if (!profile) return [];
	return profile.poses.filter((p) => !(p in doc.poses));
}

// Required doc-level anchors this doc is missing.
export function missingRequiredAnchors(
	doc: SpriteDoc,
	role: SpriteRole,
): string[] {
	const profile = ROLE_PROFILES[dirForRole(role)];
	if (!profile) return [];
	return profile.anchors.filter((a) => !(a in doc.anchors));
}

// One-line hint of what a role still needs (empty when the doc is complete).
export function requiredHintLine(doc: SpriteDoc, role: SpriteRole): string {
	const poses = missingRequiredPoses(doc, role);
	const anchors = missingRequiredAnchors(doc, role);
	if (poses.length === 0 && anchors.length === 0) return '';
	const parts: string[] = [];
	if (poses.length) parts.push(`poses: ${poses.join(', ')}`);
	if (anchors.length) parts.push(`anchors: ${anchors.join(', ')}`);
	return `needs ${parts.join(' · ')}`;
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
// Mirror view — the true left-facing render of the current frame
// ---------------------------------------------------------------------------

// The overlay glyph marking an anchor's cell on the canvas (distinct from art).
export const ANCHOR_MARKER = '✛';

export interface MirrorRender {
	rows: readonly string[];
	colors: readonly string[];
	bg: readonly string[];
	// Rendered width in cells (the left grid's row length after compilation).
	width: number;
}

// Compile the frame to a runtime Sprite and read its LEFT-facing output — the
// exact glyph/colour/bg grids the game shows when the entity faces left, with
// the glyph MIRROR table already applied. Read-only: painting stays on the
// right-facing canvas.
export function mirrorRender(doc: SpriteDoc, frameName: string): MirrorRender {
	const sprite = spriteFromDoc(doc, frameName);
	const left: Facing = -1;
	const width = sprite.rows(1)[0]?.length ?? 0;
	return {
		rows: sprite.rows(left),
		colors: sprite.colorKeys(left),
		bg: sprite.bgKeys(left),
		width,
	};
}

// Mirror anchor markers across the rendered width so they sit on the left-facing
// art where the game would place them.
export function mirrorAnchorMarkers(
	markers: readonly AnchorMarker[],
	width: number,
): AnchorMarker[] {
	const left: Facing = -1;
	return markers.map((m) => ({
		...m,
		x: mirrorAnchorX(m.x, width, left),
	}));
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
	// Optional pose / anchor-tool context (issue #339).
	pose?: string;
	anchorName?: string;
	anchorScope?: string;
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
	const pose = m.pose ? ` · pose ${m.pose}` : '';
	// In the anchor tool, surface which anchor + scope the next placement targets.
	const tool =
		m.tool === 'anchor' && m.anchorName
			? `anchor ${m.anchorName}@${m.anchorScope ?? 'doc'}`
			: m.tool;
	return `${m.id} (${m.role})${dirty}${pose} · frame ${m.frame} [${m.frameIdx + 1}/${m.frameCount}] · ${tool} · fg ${m.fgKey} · bg ${bg} · cell (${m.cell.x},${m.cell.y}) ${bitName(m.bit)}`;
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
	{ keys: 'p/e/s/a', label: 'tools' },
	{ keys: 'f/g', label: 'color' },
	{ keys: 'c', label: 'clear' },
	{ keys: '[ ]', label: 'frame' },
	{ keys: 'u/^r', label: 'undo' },
	{ keys: '^s', label: 'save' },
	{ keys: 'q', label: 'quit' },
	{ keys: 'P', label: 'poses' },
	{ keys: 'A', label: 'anchor' },
	{ keys: 'm', label: 'mirror' },
	{ keys: 'o', label: 'in-context' },
	{ keys: '. ,', label: 'play' },
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
