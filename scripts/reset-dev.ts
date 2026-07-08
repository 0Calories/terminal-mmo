// Wipe the local server save so the next launch behaves like a brand-new Player — handy for
// QA'ing the Avatar creation flow (ADR 0028). Run with `bun run dev:reset`.
//
// What it clears:
//   • Server save — the bun:sqlite DB (MMO_DB_PATH ?? "mmo-state.sqlite") + its -wal/-shm
//     sidecars. New-vs-returning is decided server-side by store.load(key), so wiping this
//     alone makes your Identity Key resolve to "no Save" — the creator re-triggers on next
//     connect regardless of whether your key is external (ssh-agent / ~/.ssh) or generated,
//     which is all QA needs.

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
