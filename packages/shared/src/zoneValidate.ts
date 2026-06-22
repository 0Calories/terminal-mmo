import { BOX } from './constants';
import { isSolid } from './terrain';
import type { Box, Terrain } from './types';
import type { Zone } from './world';
import type { Catalogs } from './zoneFormat';

export type Severity = 'error' | 'warning';

/**
 * One validation finding. `zoneId` + `cell` make a message actionable (the CLI,
 * #54, renders these). `zoneId` is `(catalogs)` for catalog-level findings.
 */
export interface Diagnostic {
	severity: Severity;
	message: string;
	zoneId: string;
	cell?: { x: number; y: number };
}

function inBounds(b: Box, t: Terrain): boolean {
	return b.x >= 0 && b.y >= 0 && b.x + b.w <= t.w && b.y + b.h <= t.h;
}

/** Any in-grid cell under the box footprint is solid. */
function clipsSolid(b: Box, t: Terrain): boolean {
	for (let y = b.y; y < b.y + b.h; y++)
		for (let x = b.x; x < b.x + b.w; x++)
			if (y >= 0 && x >= 0 && y < t.h && x < t.w && t.cells[y * t.w + x] === 1)
				return true;
	return false;
}

/** Some cell directly below the box bottom is solid (incl. the world floor). */
function restsOnGround(b: Box, t: Terrain): boolean {
	const below = b.y + b.h;
	for (let x = b.x; x < b.x + b.w; x++) if (isSolid(t, x, below)) return true;
	return false;
}

/**
 * Push placement findings for one entity box. `needsGround` adds the walkability
 * rule (spawns + NPCs must rest on ground; portals only need to fit + not clip).
 */
function checkPlacement(
	out: Diagnostic[],
	zoneId: string,
	label: string,
	b: Box,
	t: Terrain,
	needsGround: boolean,
): void {
	const cell = { x: b.x, y: b.y };
	if (!inBounds(b, t)) {
		out.push({
			severity: 'error',
			zoneId,
			cell,
			message: `${label} box at (${b.x},${b.y}) extends outside the ${t.w}×${t.h} grid`,
		});
		return; // further checks index out of range
	}
	if (clipsSolid(b, t))
		out.push({
			severity: 'error',
			zoneId,
			cell,
			message: `${label} at (${b.x},${b.y}) overlaps solid terrain`,
		});
	if (needsGround && !restsOnGround(b, t))
		out.push({
			severity: 'error',
			zoneId,
			cell,
			message: `${label} at (${b.x},${b.y}) is floating — no solid ground beneath`,
		});
}

function catalogIntegrity(catalogs: Catalogs): Diagnostic[] {
	const out: Diagnostic[] = [];
	const checkDupes = (kind: string, ids: string[]) => {
		const seen = new Set<string>();
		for (const id of ids) {
			if (seen.has(id))
				out.push({
					severity: 'error',
					zoneId: '(catalogs)',
					message: `duplicate ${kind} catalog id '${id}'`,
				});
			seen.add(id);
		}
	};
	checkDupes(
		'monster',
		catalogs.monsters.map((m) => m.id),
	);
	checkDupes(
		'npc',
		catalogs.npcs.map((n) => n.id),
	);
	return out;
}

/** Per-file placement / walkability / zone-type rules for one parsed Zone. */
function perFile(zone: Zone): Diagnostic[] {
	const out: Diagnostic[] = [];
	const t = zone.terrain;

	if (zone.type === 'town' && zone.spawns.length > 0)
		out.push({
			severity: 'error',
			zoneId: zone.id,
			message: `town Zone '${zone.id}' must have no monster spawns (found ${zone.spawns.length})`,
		});
	if (zone.type === 'field' && zone.spawns.length === 0)
		out.push({
			severity: 'error',
			zoneId: zone.id,
			message: `field Zone '${zone.id}' must have at least one monster spawn`,
		});

	for (const s of zone.spawns)
		checkPlacement(
			out,
			zone.id,
			`${s.type} spawn`,
			{ x: s.x, y: s.y, w: BOX.w, h: BOX.h },
			t,
			true,
		);
	for (const n of zone.npcs ?? [])
		checkPlacement(
			out,
			zone.id,
			`npc '${n.name}'`,
			{ x: n.x, y: n.y, w: n.w, h: n.h },
			t,
			true,
		);
	for (const p of zone.portals)
		checkPlacement(
			out,
			zone.id,
			`portal → ${p.target}`,
			{ x: p.x, y: p.y, w: p.w, h: p.h },
			t,
			false,
		);

	return out;
}

/**
 * Orphan-key check (#50, ADR 0008): a header glyph declared under spawns/npcs/
 * portals but never placed in the grid body. This is the one validator that reads
 * the RAW `.zone` text rather than a parsed Zone — parseZone silently drops keys
 * whose glyph it never encounters, so the information is gone by the time we have a
 * Zone. A malformed file (no `---` delimiter / unparseable header) yields nothing
 * here; parseZone reports those failures, and we only flag orphans in a file that
 * otherwise parses. Errors, per the format's "orphan keys are validation errors".
 */
export function findOrphanGlyphs(text: string): Diagnostic[] {
	const lines = text.split('\n');
	const di = lines.findIndex((l) => l.trim() === '---');
	if (di === -1) return [];
	let header: {
		id?: unknown;
		spawns?: Record<string, unknown>;
		npcs?: Record<string, unknown>;
		portals?: Record<string, unknown>;
	};
	try {
		header = JSON.parse(lines.slice(0, di).join('\n'));
	} catch {
		return [];
	}

	const used = new Set<string>();
	for (const line of lines.slice(di + 1)) for (const ch of line) used.add(ch);

	const zoneId = typeof header.id === 'string' ? header.id : '(zone)';
	const out: Diagnostic[] = [];
	const scan = (kind: string, map?: Record<string, unknown>) => {
		for (const ch of Object.keys(map ?? {}))
			if (!used.has(ch))
				out.push({
					severity: 'error',
					zoneId,
					message: `header ${kind} glyph '${ch}' is declared but never appears in the grid`,
				});
	};
	scan('spawn', header.spawns);
	scan('npc', header.npcs);
	scan('portal', header.portals);
	return out;
}

/** Validate one parsed Zone + its catalogs (per-file tier). Pure. */
export function validateZone(zone: Zone, catalogs: Catalogs): Diagnostic[] {
	return [...perFile(zone), ...catalogIntegrity(catalogs)];
}

/**
 * Validate a whole Zone set + catalogs (per-file tier for each, plus integrity:
 * portal targets resolve, arrivals land on walkable ground, one-way portals warn).
 * Pure.
 */
export function validateZoneSet(
	zones: Zone[],
	catalogs: Catalogs,
): Diagnostic[] {
	const out: Diagnostic[] = [...catalogIntegrity(catalogs)];
	for (const z of zones) out.push(...perFile(z));

	const byId = new Map(zones.map((z) => [z.id, z]));
	for (const z of zones) {
		for (const p of z.portals) {
			const cell = { x: p.x, y: p.y };
			const target = byId.get(p.target);
			if (!target) {
				out.push({
					severity: 'error',
					zoneId: z.id,
					cell,
					message: `portal in '${z.id}' targets unknown Zone '${p.target}'`,
				});
				continue;
			}
			const ab: Box = { x: p.arrival.x, y: p.arrival.y, w: BOX.w, h: BOX.h };
			const where = `'${z.id}' → '${p.target}'`;
			if (!inBounds(ab, target.terrain))
				out.push({
					severity: 'error',
					zoneId: z.id,
					cell,
					message: `portal ${where} arrival (${ab.x},${ab.y}) is outside the target grid`,
				});
			else {
				if (clipsSolid(ab, target.terrain))
					out.push({
						severity: 'error',
						zoneId: z.id,
						cell,
						message: `portal ${where} arrival (${ab.x},${ab.y}) lands inside solid terrain`,
					});
				if (!restsOnGround(ab, target.terrain))
					out.push({
						severity: 'error',
						zoneId: z.id,
						cell,
						message: `portal ${where} arrival (${ab.x},${ab.y}) is floating — no solid ground beneath`,
					});
			}

			if (!target.portals.some((tp) => tp.target === z.id))
				out.push({
					severity: 'warning',
					zoneId: z.id,
					cell,
					message: `one-way portal: ${where} has no return portal`,
				});
		}
	}
	return out;
}
