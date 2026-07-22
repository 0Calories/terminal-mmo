import type { Catalogs } from '@mmo/core/zones';
import { cellAt, type EditorDoc, setCell } from './doc';

export type Placeable =
	| { kind: 'terrain' }
	| { kind: 'monster'; id: string }
	| { kind: 'npc'; id: string }
	| { kind: 'portal'; target: string; arrival: [number, number] };

const RESERVED = new Set(['#', '.', ' ']);

const ALLOC_ALPHABET =
	'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

type HeaderMapName = 'spawns' | 'npcs' | 'portals';

function headerMap(
	doc: EditorDoc,
	name: HeaderMapName,
): Record<string, unknown> {
	const m = doc.header[name];
	return m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
}

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

function findGlyph(doc: EditorDoc, p: Placeable): string | undefined {
	const slot = slotOf(p);
	if (!slot) return undefined;
	for (const [g, v] of Object.entries(headerMap(doc, slot.map)))
		if (valueMatches(p, v)) return g;
	return undefined;
}

function declaredGlyphs(doc: EditorDoc): Set<string> {
	const s = new Set<string>();
	for (const name of ['spawns', 'npcs', 'portals'] as const)
		for (const g of Object.keys(headerMap(doc, name))) s.add(g);
	return s;
}

function allocateGlyph(doc: EditorDoc): string {
	const used = declaredGlyphs(doc);
	for (const ch of ALLOC_ALPHABET)
		if (!used.has(ch) && !RESERVED.has(ch)) return ch;
	throw new Error('no free glyph available for a new Placeable');
}

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

function gridHas(rows: string[], ch: string): boolean {
	return rows.some((r) => r.includes(ch));
}

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

export function erase(doc: EditorDoc, x: number, y: number): EditorDoc {
	const ch = cellAt(doc, x, y);
	if (ch === '.') return doc;
	const cleared = setCell(doc, x, y, '.');
	if (RESERVED.has(ch)) return cleared;
	return gridHas(cleared.rows, ch) ? cleared : gcGlyph(cleared, ch);
}

export interface PaletteItem {
	label: string;
	placeable?: Placeable;
}

export interface PaletteGroup {
	label: 'Terrain' | 'Monsters' | 'NPCs' | 'Structures';
	items: PaletteItem[];
}

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
