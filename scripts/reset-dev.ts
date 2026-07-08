// Wipe the local server save (the bun:sqlite DB + its -wal/-shm sidecars) so the next launch
// behaves like a brand-new Player — handy for QA'ing Avatar creation (ADR 0028). New-vs-returning
// is decided server-side by store.load(key), so wiping the save alone re-triggers the creator
// regardless of whether your key is external (ssh-agent / ~/.ssh) or generated. Run via
// `bun run dev:reset`.

import { existsSync, rmSync } from 'node:fs';

function remove(label: string, path: string): void {
	if (existsSync(path)) {
		rmSync(path, { recursive: true, force: true });
		console.log(`  removed  ${label.padEnd(12)} ${path}`);
	} else {
		console.log(`  absent   ${label.padEnd(12)} ${path}`);
	}
}

console.log('Resetting local server save…');

// Same default as server/src/index.ts; resolved from the CWD you launch the server in
// (repo root for `bun run dev:server`), which is also where this script runs.
const db = process.env.MMO_DB_PATH ?? 'mmo-state.sqlite';
console.log('Server save (bun:sqlite):');
remove('db', db);
remove('wal', `${db}-wal`);
remove('shm', `${db}-shm`);

console.log(
	'Done — server save wiped; next launch prompts a fresh Avatar creation.',
);
