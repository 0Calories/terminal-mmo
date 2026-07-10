// The write side of the forge's write → re-read loop. Reading (discovery,
// identity, parsing) lives in @mmo/assets (ADR 0033); the forge re-reads
// through it after every write, so the file — not code — stays where zone
// content lives (ADR 0031).
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { zonePath } from '@mmo/assets';

export function zoneExists(root: string, id: string): boolean {
	return existsSync(zonePath(root, id));
}

// Atomic write: temp file + rename, so a crash mid-write can't leave a half-written file.
export function writeZone(root: string, id: string, text: string): void {
	const target = zonePath(root, id);
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, target);
}

export function renameZoneFile(
	root: string,
	oldId: string,
	newId: string,
): void {
	renameSync(zonePath(root, oldId), zonePath(root, newId));
}

export function rewritePortalTarget(
	text: string,
	oldId: string,
	newId: string,
): string {
	const lines = text.split('\n');
	const di = lines.findIndex((l) => l.trim() === '---');
	if (di === -1) return text;
	const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`("target"\\s*:\\s*)"${esc}"`, 'g');
	const header = lines.slice(0, di).join('\n').replace(re, `$1"${newId}"`);
	return [header, ...lines.slice(di)].join('\n');
}
