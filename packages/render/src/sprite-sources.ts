import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

declare const MMO_EMBEDDED_SPRITES: Record<string, string>;

export interface SpriteSource {
	id: string; // filename without .sprite — globally unique identity (ADR 0011 zone precedent)
	role: string; // first directory segment under sprites/, e.g. 'hats'
	text: string; // raw file contents
}

export function spriteSourcesFromEntries(
	entries: Record<string, string>,
): ReadonlyMap<string, SpriteSource> {
	const map = new Map<string, SpriteSource>();
	for (const [key, text] of Object.entries(entries)) {
		const segments = key.split('/');
		const role = segments[0] ?? '';
		const last = segments[segments.length - 1] ?? '';
		const id = last.replace(/\.sprite$/, '');
		map.set(id, { id, role, text });
	}
	return map;
}

export function readSpriteSourcesFromDir(
	dir: string,
): ReadonlyMap<string, SpriteSource> {
	const map = new Map<string, SpriteSource>();
	if (!existsSync(dir)) return map;

	let entries: string[];
	try {
		entries = readdirSync(dir, { recursive: true }) as string[];
	} catch {
		return map;
	}

	for (const entry of entries) {
		if (!entry.endsWith('.sprite')) continue;
		const fullPath = join(dir, entry);
		let text: string;
		try {
			text = readFileSync(fullPath, 'utf8');
		} catch {
			continue;
		}
		const segments = entry.split(sep);
		const role = segments.length > 1 ? segments[0] : '';
		const last = segments[segments.length - 1] ?? '';
		const id = last.replace(/\.sprite$/, '');
		map.set(id, { id, role: role ?? '', text });
	}

	return map;
}

function findSpritesDir(): string | undefined {
	const cwdCandidate = join(process.cwd(), 'sprites');
	if (existsSync(cwdCandidate)) return cwdCandidate;

	let current = import.meta.dir;
	for (let i = 0; i < 6; i++) {
		const candidate = join(current, 'sprites');
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return undefined;
}

export function loadSpriteSources(): ReadonlyMap<string, SpriteSource> {
	if (typeof MMO_EMBEDDED_SPRITES !== 'undefined') {
		return spriteSourcesFromEntries(MMO_EMBEDDED_SPRITES);
	}

	const dir = findSpritesDir();
	if (dir) return readSpriteSourcesFromDir(dir);

	return new Map();
}
