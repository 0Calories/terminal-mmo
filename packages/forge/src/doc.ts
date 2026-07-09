import type { ZoneType } from '@mmo/shared';

export interface EditorDoc {
	header: Record<string, unknown>;
	rows: string[];
}

const DELIM = '---';

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

export function serializeDoc(doc: EditorDoc): string {
	return `${JSON.stringify(doc.header, null, 2)}\n${DELIM}\n${doc.rows.join('\n')}\n`;
}

export function cellAt(doc: EditorDoc, x: number, y: number): string {
	if (y < 0 || y >= doc.rows.length || x < 0) return '.';
	const row = doc.rows[y];
	return x < row.length ? row[x] : '.';
}

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

export function toggleSolid(doc: EditorDoc, x: number, y: number): EditorDoc {
	return setCell(doc, x, y, cellAt(doc, x, y) === '#' ? '.' : '#');
}

export function clearCell(doc: EditorDoc, x: number, y: number): EditorDoc {
	return setCell(doc, x, y, '.');
}

export function zoneName(doc: EditorDoc): string | undefined {
	const n = doc.header.name;
	return typeof n === 'string' ? n : undefined;
}

export function setZoneName(doc: EditorDoc, name: string): EditorDoc {
	const trimmed = name.trim();
	const header = { ...doc.header };
	if (trimmed) header.name = trimmed;
	else delete header.name;
	return { header, rows: doc.rows };
}

export function zoneType(doc: EditorDoc): ZoneType {
	if (doc.header.type === 'town') return 'town';
	if (doc.header.type === 'dungeon') return 'dungeon';
	return 'field';
}

export function setZoneType(doc: EditorDoc, type: ZoneType): EditorDoc {
	return { header: { ...doc.header, type }, rows: doc.rows };
}

export function placedMonsterCount(doc: EditorDoc): number {
	const spawns = doc.header.spawns;
	if (!spawns || typeof spawns !== 'object') return 0;
	const glyphs = new Set(Object.keys(spawns as Record<string, unknown>));
	if (glyphs.size === 0) return 0;
	let count = 0;
	for (const row of doc.rows) for (const ch of row) if (glyphs.has(ch)) count++;
	return count;
}

export function placeGlyph(
	doc: EditorDoc,
	x: number,
	y: number,
	ch: string,
): EditorDoc {
	return setCell(doc, x, y, ch);
}
