import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayerSave } from '@mmo/core/persistence';
import { snapshotPlayerDb } from '../src/snapshot';
import { openPlayerStore } from '../src/store';

const save: PlayerSave = {
	handle: 'Trinity',
	progress: { level: 7, xp: 420, gold: 999 },
	inventory: [],
	equippedWeapon: 2,
	cosmetics: { hue: 1, hat: 'crown', nameplate: 1, form: 'buddy' },
	lastTown: 'town-01',
	bossDefeated: false,
};

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'mmo-snapshot-'));
	dirs.push(dir);
	return dir;
}

function snapshotsIn(dir: string): string[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.bak'))
		.sort();
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

test('boot snapshots the existing DB before opening it', () => {
	const dbPath = join(tempDir(), 'mmo-state.sqlite');
	const first = openPlayerStore(dbPath);
	first.save('key-a', save);
	first.close();

	const second = openPlayerStore(dbPath);
	second.save('key-b', { ...save, handle: 'Morpheus' });
	second.close();

	const snapshots = snapshotsIn(join(dbPath, '..'));
	expect(snapshots.length).toBe(1);
	const restored = openPlayerStore(join(dbPath, '..', snapshots[0]));
	expect(restored.load('key-a')?.handle).toBe('Trinity');
	expect(restored.load('key-b')).toBeUndefined();
	restored.close();
});

test('first boot with no DB file snapshots nothing and works', () => {
	const dbPath = join(tempDir(), 'mmo-state.sqlite');
	const store = openPlayerStore(dbPath);
	store.save('key-a', save);
	expect(store.load('key-a')?.handle).toBe('Trinity');
	store.close();
	expect(snapshotsIn(join(dbPath, '..'))).toEqual([]);
});

test(':memory: paths skip snapshotting', () => {
	expect(snapshotPlayerDb(':memory:')).toBeUndefined();
});

test('retention prunes to the last N snapshots, oldest first, with wal sidecars', () => {
	const dir = tempDir();
	const dbPath = join(dir, 'mmo-state.sqlite');
	writeFileSync(dbPath, 'db');
	writeFileSync(`${dbPath}-wal`, 'wal');
	for (let i = 0; i < 6; i++) {
		const stale = `${dbPath}.2026-01-0${i + 1}T00-00-00-000Z.bak`;
		writeFileSync(stale, 'old');
		writeFileSync(`${stale}-wal`, 'old-wal');
	}

	const dest = snapshotPlayerDb(dbPath, { retain: 5 });
	expect(dest).toBeDefined();

	const kept = snapshotsIn(dir);
	expect(kept.length).toBe(5);
	expect(kept[kept.length - 1]).toBe(dest!.split('/').pop()!);
	expect(kept).not.toContain('mmo-state.sqlite.2026-01-01T00-00-00-000Z.bak');
	expect(kept).not.toContain('mmo-state.sqlite.2026-01-02T00-00-00-000Z.bak');
	const walSidecars = readdirSync(dir).filter((f) => f.endsWith('.bak-wal'));
	expect(walSidecars.length).toBe(5);
});

test('snapshot failure logs loudly, returns undefined, and boot continues', () => {
	const dbPath = join(tempDir(), 'mmo-state.sqlite');
	const store = openPlayerStore(dbPath);
	store.save('key-a', save);
	store.close();

	const logged: string[] = [];
	const dest = snapshotPlayerDb(dbPath, {
		log: (message) => logged.push(message),
		copyFile: () => {
			throw new Error('disk full');
		},
	});
	expect(dest).toBeUndefined();
	expect(logged.length).toBe(1);
	expect(logged[0]).toContain('FAILED to snapshot');

	const reopened = openPlayerStore(dbPath);
	expect(reopened.load('key-a')?.handle).toBe('Trinity');
	reopened.close();
});
