import { classifyPath } from './manifest';

const SPRITE_EXT = '.sprite';
const SEP = '\u0000';

export function spriteIdSets(
	entries: Readonly<Record<string, string>>,
): ReadonlyMap<string, readonly string[]> {
	const sets = new Map<string, string[]>();
	for (const path of Object.keys(entries).sort()) {
		if (!path.startsWith('sprites/') || !path.endsWith(SPRITE_EXT)) continue;
		const segments = path.split('/');
		const role = segments.length > 2 ? segments[1] : '';
		const last = segments[segments.length - 1] ?? '';
		const id = last.slice(0, -SPRITE_EXT.length);
		const ids = sets.get(role);
		if (ids) ids.push(id);
		else sets.set(role, [id]);
	}
	for (const ids of sets.values()) ids.sort();
	return new Map([...sets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function contractHash(
	entries: Readonly<Record<string, string>>,
): string {
	const hasher = new Bun.CryptoHasher('sha256');
	for (const path of Object.keys(entries).sort()) {
		// Unknown paths hash as contract: ambiguity fails safe toward a dual ship.
		const kind = classifyPath(path) ?? 'contract';
		if (kind !== 'contract') continue;
		hasher.update(`${path}${SEP}${entries[path]}${SEP}`);
	}
	for (const [role, ids] of spriteIdSets(entries)) {
		hasher.update(`sprite-ids/${role}${SEP}${ids.join(SEP)}${SEP}`);
	}
	return hasher.digest('hex');
}
