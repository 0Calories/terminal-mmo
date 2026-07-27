import { type BoxDims, registerSpriteBoxes } from '@mmo/core/entities';
import { type AssetEntries, entryId, SPRITE_EXT } from './store';

const SECTION_RE = /^---\s+(\S+)(?:\s+(\d+))?\s*$/;

const TRANSPARENT = new Set([' ', '·']);

/**
 * The visible-pixel bounds of a sprite's Default frame (frame 0 of the first
 * declared animation) — the one derivation both client and server register a
 * monster's logical box from, kept to a scan of the raw text so no sprite
 * *code* is reachable from the server. `sprites:check` proves it agrees with
 * the real parser's view of the same frame.
 */
export function defaultFrameBox(text: string): BoxDims | null {
	const lines = text.split('\n');
	const firstSection = lines.findIndex((l) => SECTION_RE.test(l));
	if (firstSection === -1) return null;

	let firstAnimation: string | undefined;
	try {
		const header: unknown = JSON.parse(lines.slice(0, firstSection).join('\n'));
		const animations = (header as { animations?: { name?: unknown }[] })
			?.animations;
		const name = Array.isArray(animations) ? animations[0]?.name : undefined;
		if (typeof name === 'string') firstAnimation = name;
	} catch {
		return null;
	}
	if (firstAnimation === undefined) return null;

	const art = defaultFrameArt(lines, firstSection, firstAnimation);
	if (art === null) return null;

	let minX = Number.POSITIVE_INFINITY;
	let maxX = -1;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = -1;
	art.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			if (TRANSPARENT.has(row[x])) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	});
	if (maxX < 0) return null;
	return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Every derivable Default-frame box in a role's sprite tree, keyed by id. */
export function spriteBoxes(
	role: string,
	entries: AssetEntries,
): ReadonlyMap<string, BoxDims> {
	const prefix = `sprites/${role}/`;
	const out = new Map<string, BoxDims>();
	for (const key of Object.keys(entries).sort()) {
		if (!key.startsWith(prefix) || !key.endsWith(SPRITE_EXT)) continue;
		const box = defaultFrameBox(entries[key]);
		if (box !== null) out.set(entryId(key, SPRITE_EXT), box);
	}
	return out;
}

/** Derive and hand the monster/NPC logical boxes to the core catalog. */
export function registerDerivedBoxes(entries: AssetEntries): void {
	registerSpriteBoxes({
		monsters: spriteBoxes('monsters', entries),
		npcs: spriteBoxes('npcs', entries),
	});
}

/** The Default frame's art rows: the section binding the first animation at
 *  index 0 (or unindexed), up to its first `@colors`/`@bg` marker, blank
 *  edges trimmed. */
function defaultFrameArt(
	lines: string[],
	from: number,
	animation: string,
): string[] | null {
	for (let i = from; i < lines.length; i++) {
		const m = SECTION_RE.exec(lines[i]);
		if (!m || m[1] !== animation) continue;
		if (m[2] !== undefined && Number(m[2]) !== 0) continue;
		const art: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const t = lines[j].trim();
			if (SECTION_RE.test(lines[j]) || t === '@colors' || t === '@bg') break;
			art.push(lines[j]);
		}
		while (art.length > 0 && art[0].trim() === '') art.shift();
		while (art.length > 0 && art[art.length - 1].trim() === '') art.pop();
		return art.length > 0 ? art : null;
	}
	return null;
}
