// The entity-centric editor layer (ADR 0010). The author works in **Placeables**
// — a Terrain type, a catalog Monster/NPC, or a Structure (Portal) — never in
// glyphs. This module owns the glyph↔Placeable mapping in the header: it
// allocates a glyph the first time a Placeable type is used, reuses it for
// further instances, and garbage-collects the header entry when the last
// instance is erased. Orphan glyphs (declared-but-unused) and undeclared glyphs
// become unrepresentable through the editor, not merely validated (#50).
//
// Pure: no FS, no opentui. Sits on top of the lossless `EditorDoc` (doc.ts) —
// `parseZone` is lossy, so every edit mutates the raw header + rows.

import type { Catalogs } from '@mmo/shared';
import { cellAt, type EditorDoc, setCell } from './doc';

/** A thing the editor can place into a Zone. The author selects one of these
 *  from the Palette; the editor resolves it to a header glyph on placement. */
export type Placeable =
	| { kind: 'terrain' }
	| { kind: 'monster'; id: string }
	| { kind: 'npc'; id: string }
	| { kind: 'portal'; target: string; arrival: [number, number] };

// Reserved grid glyphs (mirrors parseZone): never allocated to a Placeable.
const RESERVED = new Set(['#', '.', ' ']);

// The pool the editor draws fresh glyphs from, in a stable order so allocation is
// deterministic. None of these are reserved.
const ALLOC_ALPHABET =
	'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

type HeaderMapName = 'spawns' | 'npcs' | 'portals';

/** Read a header map as a plain object (absent / non-object → empty). */
function headerMap(
	doc: EditorDoc,
	name: HeaderMapName,
): Record<string, unknown> {
	const m = doc.header[name];
	return m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
}

/** Which header map a (non-terrain) Placeable lives under, plus the value stored
 *  against its glyph. Terrain has no header entry (it stamps the reserved `#`). */
function slotOf(p: Placeable): { map: HeaderMapName; value: unknown } | null {
	switch (p.kind) {
		case 'terrain':
			return null;
		case 'monster':
			return { map: 'spawns', value: p.id };
		case 'npc':
			return { map: 'npcs', value: p.id };
		case 'portal':
			return {
				map: 'portals',
				value: { target: p.target, arrival: p.arrival },
			};
	}
}

/** Does a stored header value denote the same Placeable type as `p`? Monsters and
 *  NPCs share a glyph per catalog id; data-carrying Portals share one per config. */
function valueMatches(p: Placeable, v: unknown): boolean {
	if (p.kind === 'monster' || p.kind === 'npc') return v === p.id;
	if (p.kind === 'portal') {
		const o = v as { target?: unknown; arrival?: unknown };
		const arr = o?.arrival as [unknown, unknown] | undefined;
		return (
			o?.target === p.target &&
			Array.isArray(arr) &&
			arr[0] === p.arrival[0] &&
			arr[1] === p.arrival[1]
		);
	}
	return false;
}

/** The glyph already mapped to this Placeable type, or undefined if unused. */
function findGlyph(doc: EditorDoc, p: Placeable): string | undefined {
	const slot = slotOf(p);
	if (!slot) return undefined;
	for (const [g, v] of Object.entries(headerMap(doc, slot.map)))
		if (valueMatches(p, v)) return g;
	return undefined;
}

/** Every glyph declared in any header map — the set allocation must avoid. */
function declaredGlyphs(doc: EditorDoc): Set<string> {
	const s = new Set<string>();
	for (const name of ['spawns', 'npcs', 'portals'] as const)
		for (const g of Object.keys(headerMap(doc, name))) s.add(g);
	return s;
}

/** Pick the first free glyph from the pool (not reserved, not already declared). */
function allocateGlyph(doc: EditorDoc): string {
	const used = declaredGlyphs(doc);
	for (const ch of ALLOC_ALPHABET)
		if (!used.has(ch) && !RESERVED.has(ch)) return ch;
	throw new Error('no free glyph available for a new Placeable');
}

/**
 * Place a Placeable at `(x, y)`, returning a new doc. Terrain stamps the reserved
 * `#`. For a catalog/structure Placeable, the editor reuses the glyph already
 * mapped to that type, or allocates a fresh one and adds its header entry, then
 * stamps it — so a placed glyph is always declared. Out-of-grid is a no-op (and
 * allocates nothing, so no orphan entry is ever created).
 */
export function place(
	doc: EditorDoc,
	x: number,
	y: number,
	p: Placeable,
): EditorDoc {
	if (x < 0 || y < 0 || y >= doc.rows.length) return doc;
	if (p.kind === 'terrain') return setCell(doc, x, y, '#');

	const slot = slotOf(p);
	if (!slot) return doc;
	let glyph = findGlyph(doc, p);
	let header = doc.header;
	if (!glyph) {
		glyph = allocateGlyph(doc);
		header = {
			...doc.header,
			[slot.map]: { ...headerMap(doc, slot.map), [glyph]: slot.value },
		};
	}
	return setCell({ header, rows: doc.rows }, x, y, glyph);
}

/** Does any grid row contain `ch`? */
function gridHas(rows: string[], ch: string): boolean {
	return rows.some((r) => r.includes(ch));
}

/** Drop `ch`'s entry from whichever header map declares it (immutable). */
function gcGlyph(doc: EditorDoc, ch: string): EditorDoc {
	for (const name of ['spawns', 'npcs', 'portals'] as const) {
		const m = headerMap(doc, name);
		if (ch in m) {
			const next = { ...m };
			delete next[ch];
			return { header: { ...doc.header, [name]: next }, rows: doc.rows };
		}
	}
	return doc;
}

/**
 * Erase whatever Placeable occupies `(x, y)`, returning a new doc. Clears the cell
 * to `.`; if that was the LAST instance of a catalog/structure glyph, its header
 * entry is garbage-collected so no orphan declaration survives. Terrain (`#`) has
 * no header entry. Erasing an empty cell is a no-op.
 */
export function erase(doc: EditorDoc, x: number, y: number): EditorDoc {
	const ch = cellAt(doc, x, y);
	if (ch === '.') return doc;
	const cleared = setCell(doc, x, y, '.');
	if (RESERVED.has(ch)) return cleared; // terrain / blank — no header entry
	return gridHas(cleared.rows, ch) ? cleared : gcGlyph(cleared, ch);
}

/** One selectable entry in the Palette. `placeable` is absent for a not-yet-wired
 *  slot (Spawn / Respawn stubs; Portal needs a config form — #97). */
export interface PaletteItem {
	label: string;
	placeable?: Placeable;
}

/** A labelled group of Palette entries. */
export interface PaletteGroup {
	label: 'Terrain' | 'Monsters' | 'NPCs' | 'Structures';
	items: PaletteItem[];
}

/**
 * Build the Palette from the catalog plus the structural primitives (ADR 0010).
 * The editor CONSUMES the catalog — it never edits it. Monsters/NPCs come straight
 * from `catalogs`; Structures are stub slots until their forms land (Portal #97).
 */
export function buildPalette(catalogs: Catalogs): PaletteGroup[] {
	return [
		{
			label: 'Terrain',
			items: [{ label: 'Solid', placeable: { kind: 'terrain' } }],
		},
		{
			label: 'Monsters',
			items: catalogs.monsters.map((m) => ({
				label: m.name,
				placeable: { kind: 'monster', id: m.id },
			})),
		},
		{
			label: 'NPCs',
			items: catalogs.npcs.map((n) => ({
				label: n.name,
				placeable: { kind: 'npc', id: n.id },
			})),
		},
		{
			label: 'Structures',
			items: [{ label: 'Portal' }, { label: 'Spawn' }, { label: 'Respawn' }],
		},
	];
}
