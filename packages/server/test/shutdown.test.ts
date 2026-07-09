import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShutdown } from '../src/shutdown';
import { openPlayerStore } from '../src/store';

const richSave = () => ({
	handle: 'Trinity',
	progress: { level: 7, xp: 420, gold: 999 },
	inventory: [],
	equippedWeapon: 2,
	cosmetics: { hue: 1, hat: '', nameplate: 1, form: 0 },
	lastTown: 'town-01' as const,
	bossDefeated: true,
});

test('shutdown flushes dirty state, then closes the store, then exits 0', () => {
	const calls: string[] = [];
	const shutdown = createShutdown({
		flushAll: () => calls.push('flush'),
		close: () => calls.push('close'),
		exit: (code) => calls.push(`exit:${code}`),
		log: () => {},
	});

	shutdown('SIGTERM');

	expect(calls).toEqual(['flush', 'close', 'exit:0']);
});

test('a repeated / cross signal is idempotent — never double-flush or double-close', () => {
	let flushes = 0;
	let closes = 0;
	let exits = 0;
	const shutdown = createShutdown({
		flushAll: () => flushes++,
		close: () => closes++,
		exit: () => exits++,
		log: () => {},
	});

	shutdown('SIGINT');
	shutdown('SIGTERM');
	shutdown('SIGINT');

	expect(flushes).toBe(1);
	expect(closes).toBe(1);
	expect(exits).toBe(1);
});

test('a throwing flush still closes the store and exits — no stranded handle', () => {
	const calls: string[] = [];
	let loggedError = false;
	const shutdown = createShutdown({
		flushAll: () => {
			calls.push('flush');
			throw new Error('one bad save');
		},
		close: () => calls.push('close'),
		exit: (code) => calls.push(`exit:${code}`),
		log: () => {},
		logError: () => {
			loggedError = true;
		},
	});

	shutdown('SIGTERM');

	expect(calls).toEqual(['flush', 'close', 'exit:0']);
	expect(loggedError).toBe(true);
});

test('no progress loss: state flushed only at shutdown survives via close()', () => {
	const dir = mkdtempSync(join(tmpdir(), 'mmo-shutdown-'));
	const path = join(dir, 'state.sqlite');
	try {
		const store = openPlayerStore(path);
		const key = 'ssh-ed25519 AAAAtestkeyblob';

		const shutdown = createShutdown({
			flushAll: () => store.save(key, richSave()),
			close: () => store.close(),
			exit: () => {},
			log: () => {},
		});
		shutdown('SIGTERM');

		expect(existsSync(path)).toBe(true);

		const reopened = openPlayerStore(path);
		expect(reopened.load(key)).toEqual(richSave());
		reopened.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
