// Wipe local dev state so the next launch behaves like a brand-new Player — handy for
// QA'ing the Avatar creation flow (ADR 0028). Run with `bun run dev:reset`.
//
// What it clears:
//   • Server save — the bun:sqlite DB (MMO_DB_PATH ?? "mmo-state.sqlite") + its -wal/-shm
//     sidecars. New-vs-returning is decided server-side by store.load(key), so wiping this
//     alone makes your Identity Key look NEW and the creator appears on next connect.
//   • Client config — the XDG dir (~/.config/terminal-mmo, honoring XDG_CONFIG_HOME) holding
//     the identity anchor, the generated fallback key, and audio prefs.
//
// NOTE: if you authenticate with a real external SSH key (ssh-agent / ~/.ssh/id_ed25519),
// your Identity Key is durable and NOT changed by clearing the client config — that's by
// design. To see the "new account" flow you only need the server wipe; clear the client too
// for a fully fresh generated identity (or point XDG_CONFIG_HOME/MMO_DB_PATH at a temp dir).
//
// Flags: --server-only (leave client config), --client-only (leave the save DB).

import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const clientOnly = args.has('--client-only');
const serverOnly = args.has('--server-only');
if (clientOnly && serverOnly) {
	console.error('Pass at most one of --server-only / --client-only.');
	process.exit(1);
}

function remove(label: string, path: string): void {
	if (existsSync(path)) {
		rmSync(path, { recursive: true, force: true });
		console.log(`  removed  ${label.padEnd(12)} ${path}`);
	} else {
		console.log(`  absent   ${label.padEnd(12)} ${path}`);
	}
}

console.log('Resetting local dev state…');

if (!clientOnly) {
	// Same default as server/src/index.ts; resolved from the CWD you launch the server in
	// (repo root for `bun run dev:server`), which is also where this script runs.
	const db = process.env.MMO_DB_PATH ?? 'mmo-state.sqlite';
	console.log('Server save (bun:sqlite):');
	remove('db', db);
	remove('wal', `${db}-wal`);
	remove('shm', `${db}-shm`);
}

if (!serverOnly) {
	// Same resolution as client/src/config.ts resolveConfigPath().
	const base =
		process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
	const dir = join(base, 'terminal-mmo');
	console.log('Client config + identity (XDG):');
	remove('config dir', dir);
}

console.log(
	'Done — next launch starts fresh; a new account will be prompted to create an Avatar.',
);
