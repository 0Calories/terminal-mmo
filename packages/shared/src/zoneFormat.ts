import { NPC_BOX, PORTAL_BOX, ZONE_MAX } from './constants';
import { terrainCell } from './terrain';
import type { Entity, Npc, SpawnPoint, Terrain } from './types';
import { type Portal, spawnMonster, type Zone, type ZoneType } from './world';

// Entity boxes are engine-derived from the anchor glyph, not authored (ADR 0008);
// footprint dims live in constants.ts, shared with the editor placement ghost (#96).

/** A spawn glyph resolves to one of these. */
export interface MonsterCatalogEntry {
	id: string;
	behavior: 'chaser' | 'shooter' | 'brute';
	name: string;
}

/** An npc glyph resolves to one of these. */
export interface NpcCatalogEntry {
	id: string;
	kind: 'vendor' | 'signpost';
	name: string;
	// Signpost dialogue (PRD story 9); unused by a vendor.
	lines?: string[];
}

export interface Catalogs {
	monsters: MonsterCatalogEntry[];
	npcs: NpcCatalogEntry[];
}

/**
 * Malformed `.zone` or catalog reference. `code` is a stable tag the validator (#53)
 * turns into a human message; parseZone fails safe, never half-builds a Zone.
 */
export class ZoneParseError extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
		this.name = 'ZoneParseError';
	}
}

export function resolveMonster(
	catalog: MonsterCatalogEntry[],
	id: string,
): MonsterCatalogEntry {
	const e = catalog.find((m) => m.id === id);
	if (!e)
		throw new ZoneParseError(
			'unknown-monster',
			`monster id '${id}' not in catalog`,
		);
	return e;
}

export function resolveNpc(
	catalog: NpcCatalogEntry[],
	id: string,
): NpcCatalogEntry {
	const e = catalog.find((n) => n.id === id);
	if (!e)
		throw new ZoneParseError('unknown-npc', `npc id '${id}' not in catalog`);
	return e;
}

interface PortalSpec {
	target: string;
	arrival: [number, number];
}
interface ZoneHeader {
	name?: string;
	type: string;
	spawns?: Record<string, string>;
	npcs?: Record<string, string>;
	portals?: Record<string, PortalSpec>;
}

type Glyph =
	| { kind: 'spawn'; ref: string }
	| { kind: 'npc'; ref: string }
	| { kind: 'portal'; ref: PortalSpec };

/**
 * Loads the `.zone` format (ADR 0008): a JSON header, a `---` line, then an ASCII
 * grid where `#` is a wall, `=` a one-way platform (ADR 0026), `.` empty, and every
 * other glyph anchors an entity resolved through the header maps + catalogs.
 *
 * `id` comes from the FILENAME (ADR 0011), never the header, so the two can't drift.
 */
export function parseZone(text: string, catalogs: Catalogs, id: string): Zone {
	const lines = text.split('\n');
	const di = lines.findIndex((l) => l.trim() === '---');
	if (di === -1)
		throw new ZoneParseError(
			'no-delimiter',
			"missing '---' delimiter between header and grid",
		);

	const header = parseHeader(lines.slice(0, di).join('\n'));
	const glyphs = buildGlyphMap(header);

	const body = lines.slice(di + 1);
	while (body.length > 0 && body[body.length - 1] === '') body.pop();
	const h = body.length;
	const w = body.reduce((m, l) => Math.max(m, l.length), 0);
	if (h === 0 || w === 0)
		throw new ZoneParseError('empty-grid', 'grid has no cells');
	if (w > ZONE_MAX.w || h > ZONE_MAX.h)
		throw new ZoneParseError(
			'too-large',
			`grid ${w}×${h} is too large (cap ${ZONE_MAX.w}×${ZONE_MAX.h})`,
		);

	const cells = new Uint8Array(w * h);
	const spawns: SpawnPoint[] = [];
	const monsters: Entity[] = [];
	const npcs: Npc[] = [];
	const portals: Portal[] = [];
	let nextMonsterId = 2; // the Avatar is id 1
	let nextNpcId = 1;

	for (let y = 0; y < h; y++) {
		const line = body[y];
		for (let x = 0; x < line.length; x++) {
			const ch = line[x];
			// A terrain glyph sets the cell; anything else is an entity anchor.
			const cell = terrainCell(ch);
			if (cell !== undefined) {
				if (cell) cells[y * w + x] = cell;
				continue;
			}
			const g = glyphs.get(ch);
			if (!g)
				throw new ZoneParseError(
					'unknown-glyph',
					`glyph '${ch}' at (${x},${y}) is not declared in the header`,
				);
			if (g.kind === 'spawn') {
				const type = resolveMonster(catalogs.monsters, g.ref).behavior;
				monsters.push(spawnMonster(type, nextMonsterId++, x, y, spawns.length));
				spawns.push({ type, x, y });
			} else if (g.kind === 'npc') {
				const entry = resolveNpc(catalogs.npcs, g.ref);
				npcs.push({
					id: nextNpcId++,
					kind: entry.kind,
					name: entry.name,
					...(entry.lines !== undefined ? { lines: entry.lines } : {}),
					x,
					y,
					w: NPC_BOX.w,
					h: NPC_BOX.h,
				});
			} else {
				portals.push({
					x,
					y,
					w: PORTAL_BOX.w,
					h: PORTAL_BOX.h,
					target: g.ref.target,
					arrival: { x: g.ref.arrival[0], y: g.ref.arrival[1] },
				});
			}
		}
	}

	const zone: Zone = {
		id,
		type: header.type as ZoneType,
		...(header.name !== undefined ? { name: header.name } : {}),
		terrain: { w, h, cells } satisfies Terrain,
		monsters,
		projectiles: [],
		nextProjectileId: 1,
		spawns,
		respawns: [],
		nextMonsterId,
		portals,
	};
	if (npcs.length > 0) zone.npcs = npcs;
	return zone;
}

function parseHeader(text: string): ZoneHeader {
	let header: ZoneHeader;
	try {
		header = JSON.parse(text);
	} catch (e) {
		throw new ZoneParseError(
			'bad-json',
			`header is not valid JSON: ${(e as Error).message}`,
		);
	}
	// Reject a header `id` outright rather than ignore it: the id is the filename, and
	// a second source of identity would drift (ADR 0011).
	if ('id' in header)
		throw new ZoneParseError(
			'bad-header',
			"header must not carry an 'id' — a Zone's id is its filename (ADR 0011)",
		);
	if (
		header.type !== 'field' &&
		header.type !== 'town' &&
		header.type !== 'dungeon'
	)
		throw new ZoneParseError(
			'bad-header',
			`header.type must be 'field', 'town', or 'dungeon', got '${header.type}'`,
		);
	if (header.name !== undefined && typeof header.name !== 'string')
		throw new ZoneParseError(
			'bad-header',
			`header.name must be a string when present, got ${typeof header.name}`,
		);
	return header;
}

/** Collapse the header's per-kind maps into one glyph→ref table, rejecting clashes. */
function buildGlyphMap(header: ZoneHeader): Map<string, Glyph> {
	const map = new Map<string, Glyph>();
	const add = (ch: string, g: Glyph) => {
		if (ch.length !== 1)
			throw new ZoneParseError(
				'bad-header',
				`glyph key '${ch}' must be one character`,
			);
		if (ch === '#' || ch === '=' || ch === '.' || ch === ' ')
			throw new ZoneParseError(
				'bad-header',
				`'${ch}' is reserved and cannot be a glyph key`,
			);
		if (map.has(ch))
			throw new ZoneParseError(
				'bad-header',
				`glyph '${ch}' is declared more than once`,
			);
		map.set(ch, g);
	};
	for (const [ch, ref] of Object.entries(header.spawns ?? {}))
		add(ch, { kind: 'spawn', ref });
	for (const [ch, ref] of Object.entries(header.npcs ?? {}))
		add(ch, { kind: 'npc', ref });
	for (const [ch, ref] of Object.entries(header.portals ?? {}))
		add(ch, { kind: 'portal', ref });
	return map;
}
