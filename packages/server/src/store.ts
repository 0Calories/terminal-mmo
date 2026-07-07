// The bun:sqlite backing of the persistence seam (#236). This is the ONLY place in the
// server that touches a database: it implements the pure `PlayerStore` interface from
// @mmo/shared, so all the game logic stays storage-free and the round-trip is unit-tested
// against an in-memory sqlite (`openPlayerStore(':memory:')`). One row per account, keyed
// by its canonical public key (ADR 0004); the durable `PlayerSave` is stored as a JSON
// blob, with the Handle mirrored into its own unique column so the account registry
// (public key ↔ Handle) can be rebuilt on startup.

import { Database } from 'bun:sqlite';
import type { PlayerSave, PlayerStore } from '@mmo/shared';

interface Row {
	key: string;
	data: string;
}

// Open (or create) a sqlite-backed PlayerStore at `path`. Pass ':memory:' for an
// ephemeral database — the test backing, and a safe default if no path is configured.
export function openPlayerStore(path = ':memory:'): PlayerStore {
	const db = new Database(path);
	// WAL keeps concurrent reads snappy and survives an unclean shutdown better; a no-op
	// for :memory:.
	db.run('PRAGMA journal_mode = WAL;');
	db.run(
		`CREATE TABLE IF NOT EXISTS players (
			key          TEXT PRIMARY KEY,
			handle       TEXT NOT NULL,
			handle_lower TEXT NOT NULL UNIQUE,
			data         TEXT NOT NULL
		);`,
	);

	const selectOne = db.query<Row, [string]>(
		'SELECT key, data FROM players WHERE key = ?;',
	);
	const selectAll = db.query<Row, []>('SELECT key, data FROM players;');
	// Upsert keyed by the account's canonical public key. `handle_lower` is kept in sync
	// so the UNIQUE index enforces one-Handle-per-key at the storage layer too.
	const upsert = db.query<unknown, [string, string, string, string]>(
		`INSERT INTO players (key, handle, handle_lower, data)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET
		   handle = excluded.handle,
		   handle_lower = excluded.handle_lower,
		   data = excluded.data;`,
	);

	return {
		load(key: string): PlayerSave | undefined {
			const row = selectOne.get(key);
			return row ? (JSON.parse(row.data) as PlayerSave) : undefined;
		},
		save(key: string, save: PlayerSave): void {
			upsert.run(
				key,
				save.handle,
				save.handle.toLowerCase(),
				JSON.stringify(save),
			);
		},
		all(): Array<[string, PlayerSave]> {
			return selectAll
				.all()
				.map((r) => [r.key, JSON.parse(r.data) as PlayerSave]);
		},
		close(): void {
			db.close();
		},
	};
}
