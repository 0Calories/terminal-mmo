import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const SNAPSHOT_RETENTION = 5;

export interface SnapshotOptions {
	retain?: number;
	log?: (message: string, error: unknown) => void;
	copyFile?: (src: string, dest: string) => void;
}

export function snapshotPlayerDb(
	path: string,
	options: SnapshotOptions = {},
): string | undefined {
	const {
		retain = SNAPSHOT_RETENTION,
		log = (message, error) => console.error(message, error),
		copyFile = copyFileSync,
	} = options;
	if (path === ':memory:' || !existsSync(path)) return undefined;

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dest = `${path}.${stamp}.bak`;
	try {
		copyFile(path, dest);
		if (existsSync(`${path}-wal`)) copyFile(`${path}-wal`, `${dest}-wal`);
	} catch (error) {
		log(
			`FAILED to snapshot player DB ${path} — booting WITHOUT a fresh restore point`,
			error,
		);
		return undefined;
	}
	try {
		pruneSnapshots(path, retain);
	} catch (error) {
		log(`failed to prune old player DB snapshots beside ${path}`, error);
	}
	return dest;
}

function pruneSnapshots(path: string, retain: number): void {
	const dir = dirname(path);
	const escaped = basename(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`^${escaped}\\..+\\.bak$`);
	const snapshots = readdirSync(dir)
		.filter((name) => pattern.test(name))
		.sort();
	for (const stale of snapshots.slice(
		0,
		Math.max(0, snapshots.length - retain),
	)) {
		unlinkSync(join(dir, stale));
		const wal = join(dir, `${stale}-wal`);
		if (existsSync(wal)) unlinkSync(wal);
	}
}
