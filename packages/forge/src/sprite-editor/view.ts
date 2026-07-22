import { type Facing, HUES, type RGBAQuad } from '@mmo/core/entities';
import { RARITY_COLOR } from '@mmo/core/items';
import { mirrorAnchorX } from '@mmo/core/sprites';
import {
	allFrames,
	ROLE_PROFILES,
	SENTINEL,
	type SpriteDoc,
	spriteFromDoc,
} from '@mmo/render';
import type { AnchorMarker, DynamicPreviews } from './state';
import type { SpriteRole } from './templates';

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

export function missingRequiredAnimations(
	doc: SpriteDoc,
	role: SpriteRole,
): string[] {
	const profile = ROLE_PROFILES[dirForRole(role)];
	if (!profile) return [];
	const names = new Set(doc.animations.map((a) => a.name));
	return profile.animations.filter((p) => !names.has(p));
}

export function requiredAnchors(role: SpriteRole): readonly string[] {
	return ROLE_PROFILES[dirForRole(role)]?.anchors ?? [];
}

export function missingRequiredAnchors(
	doc: SpriteDoc,
	role: SpriteRole,
): string[] {
	const profile = ROLE_PROFILES[dirForRole(role)];
	if (!profile) return [];
	return profile.anchors.filter((a) => !(a in doc.anchors));
}

export function requiredHintLine(doc: SpriteDoc, role: SpriteRole): string {
	const animations = missingRequiredAnimations(doc, role);
	const anchors = missingRequiredAnchors(doc, role);
	if (animations.length === 0 && anchors.length === 0) return '';
	const parts: string[] = [];
	if (animations.length) parts.push(`animations: ${animations.join(', ')}`);
	if (anchors.length) parts.push(`anchors: ${anchors.join(', ')}`);
	return `needs ${parts.join(' · ')}`;
}

export interface EditTarget {
	id: string;

	role?: SpriteRole;
}

export function parseEditArg(arg: string): EditTarget | undefined {
	if (!arg) return undefined;
	const clean = arg.replace(/\.sprite$/, '');
	const slash = clean.lastIndexOf('/');
	if (slash < 0) return { id: clean };
	const dir = clean.slice(0, slash);
	const id = clean.slice(slash + 1);
	if (!id) return undefined;

	const dirSeg = dir.slice(dir.lastIndexOf('/') + 1);
	return { id, role: roleForDir(dirSeg) };
}

export const SPRITE_PREVIEWS: DynamicPreviews = {
	p: [255, 150, 40, 255],
	a: [120, 200, 255, 255],
};

export const PLAYER_HUE_CYCLE: readonly RGBAQuad[] = HUES;
export const ACCENT_CYCLE: readonly RGBAQuad[] = Object.values(RARITY_COLOR);

function cycleAt(cycle: readonly RGBAQuad[], phase: number): RGBAQuad {
	const n = cycle.length;
	return cycle[((phase % n) + n) % n];
}

export function variantPreviews(p: number, a: number): DynamicPreviews {
	return {
		p: cycleAt(PLAYER_HUE_CYCLE, p),
		a: cycleAt(ACCENT_CYCLE, a),
	};
}

export interface DynamicUsage {
	p: boolean;
	a: boolean;
}

export function docDynamicUsage(doc: SpriteDoc): DynamicUsage {
	const usage = { p: false, a: false };
	const mark = (key: string) => {
		if (key === 'p') usage.p = true;
		else if (key === 'a') usage.a = true;
	};
	for (const f of allFrames(doc)) {
		for (const row of f.colors)
			for (const ch of row) mark(ch === SENTINEL ? doc.key : ch);
		for (const row of f.bg) for (const ch of row) if (ch !== SENTINEL) mark(ch);
	}
	return usage;
}

export interface VariantOption {
	channel: 'p' | 'a';
	index: number;
	rgba: RGBAQuad;
	active: boolean;
}

export function variantOptions(
	usage: DynamicUsage,
	active: { p: number; a: number },
): VariantOption[] {
	const out: VariantOption[] = [];
	const channel = (
		name: 'p' | 'a',
		cycle: readonly RGBAQuad[],
		current: number,
	) => {
		cycle.forEach((rgba, index) => {
			out.push({ channel: name, index, rgba, active: index === current });
		});
	};
	if (usage.p) channel('p', PLAYER_HUE_CYCLE, active.p);
	if (usage.a) channel('a', ACCENT_CYCLE, active.a);
	return out;
}

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

export const ZOOM_LADDER = [1, 2, 3, 4, 6] as const;
export const DEFAULT_ZOOM = 2;

export function stepZoom(zoom: number, dir: number): number {
	let cur = ZOOM_LADDER.indexOf(zoom as (typeof ZOOM_LADDER)[number]);
	if (cur < 0) {
		cur = ZOOM_LADDER.reduce(
			(best, z, i) =>
				Math.abs(z - zoom) < Math.abs(ZOOM_LADDER[best] - zoom) ? i : best,
			0,
		);
	}
	const next = Math.min(ZOOM_LADDER.length - 1, Math.max(0, cur + dir));
	return ZOOM_LADDER[next];
}

export function visiblePixels(screenLen: number, zoom: number): number {
	return Math.max(1, Math.floor(screenLen / zoom));
}

export function screenToPixel(
	sx: number,
	sy: number,
	cam: Cam,
	zoom: number,
): { x: number; y: number } {
	return { x: cam.x + Math.floor(sx / zoom), y: cam.y + Math.floor(sy / zoom) };
}

export function pixelToScreen(
	px: number,
	py: number,
	cam: Cam,
	zoom: number,
): { x: number; y: number } {
	return { x: (px - cam.x) * zoom, y: (py - cam.y) * zoom };
}

export const ANCHOR_MARKER = '✛';

export interface MirrorRender {
	rows: readonly string[];
	colors: readonly string[];
	bg: readonly string[];

	width: number;
}

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

const QUADRANT_MARKERS = ['▘', '▝', '▖', '▗'] as const;

export function quadrantMarker(bit: number): string {
	return QUADRANT_MARKERS[bit] ?? '▘';
}

export interface SpriteStatusModel {
	id: string;
	role: SpriteRole;
	frame: string;
	frameIdx: number;
	frameCount: number;
	tool: string;

	ink: string;

	pixel: { x: number; y: number };
	cell: { x: number; y: number };
	bit: number;

	zoom: number;
	dirty: boolean;

	animation?: string;
	anchorName?: string;
	anchorScope?: string;
}

const BIT_NAMES = ['TL', 'TR', 'BL', 'BR'] as const;

export function bitName(bit: number): string {
	return BIT_NAMES[bit] ?? '?';
}

export function spriteStatusLine(m: SpriteStatusModel): string {
	const dirty = m.dirty ? ' *' : '';
	const animation = m.animation ? ` · animation ${m.animation}` : '';

	const tool =
		m.tool === 'anchor' && m.anchorName
			? `anchor ${m.anchorName}@${m.anchorScope ?? 'doc'}`
			: m.tool;
	return `${m.id} (${m.role})${dirty}${animation} · frame ${m.frameIdx + 1}/${m.frameCount} · ${tool} · ×${m.zoom} · ink ${m.ink} · px (${m.pixel.x},${m.pixel.y}) cell (${m.cell.x},${m.cell.y}) ${bitName(m.bit)}`;
}

export function composeStatusLine(
	left: string,
	right: string,
	width: number,
): string {
	if (width <= 0) return '';
	const l = left.slice(0, width);
	if (!right) return l;
	const r = right.slice(0, width);

	if (l.length + 1 + r.length > width) return l;
	const pad = width - l.length - r.length;
	return l + ' '.repeat(pad) + r;
}

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
