// The editor's source of truth is the RAW `.zone` document — a JSON header object
// plus the char-grid rows — NOT a parsed `Zone`. `parseZone` is lossy (a spawn
// glyph `c` resolves to `behavior: 'chaser'` and the original glyph + catalog id
// are discarded; unused header keys are dropped — see #50's orphan-key work), so
// an editor that round-tripped through a `Zone` would lose identity. `EditorDoc`
// keeps the header VERBATIM and the grid as raw rows, so `serializeDoc(parseDoc(
// text))` preserves exactly what was authored. All pure: no FS, sibling to the
// readers in `io.ts` (which owns the disk side).

import type { ZoneType } from '@mmo/shared';

/** A `.zone` document held losslessly for editing: header object + grid rows. */
export interface EditorDoc {
	/** The header JSON, kept verbatim so nothing (orphan keys, catalog refs,
	 *  dialogue, …) is dropped on a round-trip. */
	header: Record<string, unknown>;
	/** The grid below the `---`, one string per row (trailing blanks trimmed). */
	rows: string[];
}

const DELIM = '---';

/**
 * Split raw `.zone` text into its header object and grid rows. Mirrors how
 * `parseZone` finds the `---` delimiter, but keeps the whole header object and
 * the raw rows instead of resolving (and discarding) them. Throws on a missing
 * delimiter or unparseable header — the editor only opens a parseable file.
 */
export function parseDoc(text: string): EditorDoc {
	const lines = text.split('\n');
	const di = lines.findIndex((l) => l.trim() === DELIM);
	if (di === -1)
		throw new Error(`missing '${DELIM}' delimiter between header and grid`);

	let header: Record<string, unknown>;
	try {
		header = JSON.parse(lines.slice(0, di).join('\n'));
	} catch (e) {
		throw new Error(`header is not valid JSON: ${(e as Error).message}`);
	}

	const rows = lines.slice(di + 1);
	while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
	return { header, rows };
}

/**
 * Serialize a doc back to canonical `.zone` text: pretty-printed header, the
 * `---` delimiter, then the grid plus a trailing newline. Matches the shape
 * `newZoneTemplate` emits, so a canonical file round-trips byte-for-byte.
 */
export function serializeDoc(doc: EditorDoc): string {
	return `${JSON.stringify(doc.header, null, 2)}\n${DELIM}\n${doc.rows.join('\n')}\n`;
}

/** The glyph at `(x, y)`, or `.` (empty) for any out-of-grid / past-row-end cell
 *  — rows may be ragged, exactly as `parseZone` treats a short line. */
export function cellAt(doc: EditorDoc, x: number, y: number): string {
	if (y < 0 || y >= doc.rows.length || x < 0) return '.';
	const row = doc.rows[y];
	return x < row.length ? row[x] : '.';
}

/**
 * Return a new doc with `(x, y)` set to `ch`. Immutable (the edit ops below feed
 * the undo stack with snapshots). A short row is padded with `.` so a glyph can
 * be placed past its current end; an out-of-grid coordinate is a no-op.
 */
export function setCell(
	doc: EditorDoc,
	x: number,
	y: number,
	ch: string,
): EditorDoc {
	if (y < 0 || y >= doc.rows.length || x < 0) return doc;
	const rows = doc.rows.slice();
	const row = rows[y].padEnd(x, '.');
	rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
	return { header: doc.header, rows };
}

/** Toggle terrain solidity at `(x, y)`: `#` ↔ `.` (any non-`#` becomes solid). */
export function toggleSolid(doc: EditorDoc, x: number, y: number): EditorDoc {
	return setCell(doc, x, y, cellAt(doc, x, y) === '#' ? '.' : '#');
}

/** Reset `(x, y)` to empty (`.`). */
export function clearCell(doc: EditorDoc, x: number, y: number): EditorDoc {
	return setCell(doc, x, y, '.');
}

// --- Header fields: display name + zone type (#99) ----------------------------
// Pure, immutable header mutators (like the grid ops above) — they return a fresh
// doc so the editor's undo stack keeps snapshots. The header is kept verbatim, so a
// name/type edit round-trips losslessly through serializeDoc.

/** The optional display label (#99), or undefined when unset. */
export function zoneName(doc: EditorDoc): string | undefined {
	const n = doc.header.name;
	return typeof n === 'string' ? n : undefined;
}

/** Set the display label (trimmed). An empty/whitespace name removes the key so the
 *  header stays clean rather than serializing `"name": ""`. */
export function setZoneName(doc: EditorDoc, name: string): EditorDoc {
	const trimmed = name.trim();
	const header = { ...doc.header };
	if (trimmed) header.name = trimmed;
	else delete header.name;
	return { header, rows: doc.rows };
}

/** The Zone type (`field`|`town`|`dungeon`); anything unexpected reads as `field`. */
export function zoneType(doc: EditorDoc): ZoneType {
	if (doc.header.type === 'town') return 'town';
	if (doc.header.type === 'dungeon') return 'dungeon';
	return 'field';
}

/** Set the Zone type (the `t` toggle). Decorative on its own — live validation flags
 *  any monsters a Field→Town switch leaves invalid. */
export function setZoneType(doc: EditorDoc, type: ZoneType): EditorDoc {
	return { header: { ...doc.header, type }, rows: doc.rows };
}

/** Count grid cells anchored to a declared spawn glyph — the Monsters a Field→Town
 *  switch would invalidate (Towns forbid spawns), used to warn before the toggle. */
export function placedMonsterCount(doc: EditorDoc): number {
	const spawns = doc.header.spawns;
	if (!spawns || typeof spawns !== 'object') return 0;
	const glyphs = new Set(Object.keys(spawns as Record<string, unknown>));
	if (glyphs.size === 0) return 0;
	let count = 0;
	for (const row of doc.rows) for (const ch of row) if (glyphs.has(ch)) count++;
	return count;
}

/** Stamp an (already-declared) entity glyph at `(x, y)`. */
export function placeGlyph(
	doc: EditorDoc,
	x: number,
	y: number,
	ch: string,
): EditorDoc {
	return setCell(doc, x, y, ch);
}
