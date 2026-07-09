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

// Default must match server/src/index.ts.
const db = process.env.MMO_DB_PATH ?? 'mmo-state.sqlite';
console.log('Server save (bun:sqlite):');
remove('db', db);
remove('wal', `${db}-wal`);
remove('shm', `${db}-shm`);

console.log(
	'Done — server save wiped; next launch prompts a fresh Avatar creation.',
);
