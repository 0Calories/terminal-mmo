import { Database } from 'bun:sqlite';
import type { PlayerSave, PlayerStore } from '@mmo/core/persistence';

interface Row {
	key: string;
	data: string;
}

export function openPlayerStore(path = ':memory:'): PlayerStore {
	const db = new Database(path);
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
