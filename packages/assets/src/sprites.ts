// Sprites leave the assets package raw (ADR 0033): id + role + text, never
// compiled art. Compilation to Sprite objects stays in @mmo/render, preserving
// ADR 0030's wall — sprite *code* is unreachable from the server.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
	type AssetEntries,
	entryId,
	loadAssetEntries,
	SPRITE_EXT,
} from './store';

export interface SpriteSource {
	id: string; // filename without .sprite — globally unique identity (ADR 0011 zone precedent)
	role: string; // first directory segment under sprites/, e.g. 'hats'
	text: string; // raw file contents
}

export function spriteSourcesFromEntries(
	entries: AssetEntries,
): ReadonlyMap<string, SpriteSource> {
	const map = new Map<string, SpriteSource>();
	for (const key of Object.keys(entries).sort()) {
		if (!key.startsWith('sprites/') || !key.endsWith(SPRITE_EXT)) continue;
		const segments = key.split('/');
		const role = segments.length > 2 ? segments[1] : '';
		const id = entryId(key, SPRITE_EXT);
		map.set(id, { id, role, text: entries[key] });
	}
	return map;
}

// Explicit-root scan for the forge's `sprite check [dir]` — `dir` is a sprites
// tree root whose first-level directories are the roles.
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
		if (!entry.endsWith(SPRITE_EXT)) continue;
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
		const id = last.slice(0, -SPRITE_EXT.length);
		map.set(id, { id, role: role ?? '', text });
	}

	return map;
}

export function loadSpriteSources(): ReadonlyMap<string, SpriteSource> {
	return spriteSourcesFromEntries(loadAssetEntries());
}
