import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShutdown, DRAIN_GRACE_MS } from '../src/shutdown';
import { openPlayerStore } from '../src/store';
import { createStackScenario, joinScenarioPlayer } from './scenario';

const richSave = () => ({
	handle: 'Trinity',
	progress: { level: 7, xp: 420, gold: 999 },
	inventory: [],
	equippedWeapon: 2,
	cosmetics: { hue: 1, hat: '', nameplate: 1, form: 'buddy' },
	lastTown: 'town-01' as const,
	bossDefeated: true,
});

interface DrainOverrides {
	announce?: () => void;
	flushAll?: () => void;
	closeSessions?: () => void;
	close?: () => void;
	delay?: (ms: number) => Promise<void>;
	logError?: (msg: string, err: unknown) => void;
}

const recordedShutdown = (calls: string[], overrides: DrainOverrides = {}) =>
	createShutdown({
		announce: () => calls.push('announce'),
		flushAll: () => calls.push('flush'),
		closeSessions: () => calls.push('closeSessions'),
		close: () => calls.push('close'),
		delay: (ms) => {
			calls.push(`delay:${ms}`);
			return Promise.resolve();
		},
		exit: (code) => calls.push(`exit:${code}`),
		log: () => {},
		...overrides,
	});

test('shutdown drains in order: announce, grace, flush, close sessions, close store, exit 0', async () => {
	const calls: string[] = [];
	await recordedShutdown(calls)('SIGTERM');

	expect(calls).toEqual([
		'announce',
		`delay:${DRAIN_GRACE_MS}`,
		'flush',
		'closeSessions',
		'close',
		'exit:0',
	]);
});

test('the default grace period fits inside Railway stop grace window (~10s)', () => {
	expect(DRAIN_GRACE_MS).toBeLessThan(10_000);
	expect(DRAIN_GRACE_MS).toBeGreaterThan(0);
});

test('a second signal during the grace delay does not restart the drain', async () => {
	const calls: string[] = [];
	let releaseGrace = () => {};
	const shutdown = recordedShutdown(calls, {
		delay: () =>
			new Promise((resolve) => {
				releaseGrace = resolve;
			}),
	});

	const draining = shutdown('SIGTERM');
	await shutdown('SIGTERM');
	await shutdown('SIGINT');
	expect(calls).toEqual(['announce']);

	releaseGrace();
	await draining;

	expect(calls).toEqual([
		'announce',
		'flush',
		'closeSessions',
		'close',
		'exit:0',
	]);
});

test('a throwing announce still flushes, closes, and exits', async () => {
	const calls: string[] = [];
	let loggedError = false;
	const shutdown = recordedShutdown(calls, {
		announce: () => {
			calls.push('announce');
			throw new Error('broadcast blew up');
		},
		logError: () => {
			loggedError = true;
		},
	});

	await shutdown('SIGTERM');

	expect(calls).toEqual([
		'announce',
		`delay:${DRAIN_GRACE_MS}`,
		'flush',
		'closeSessions',
		'close',
		'exit:0',
	]);
	expect(loggedError).toBe(true);
});

test('a throwing flush still closes sessions and the store — no stranded handle', async () => {
	const calls: string[] = [];
	let loggedError = false;
	const shutdown = recordedShutdown(calls, {
		flushAll: () => {
			calls.push('flush');
			throw new Error('one bad save');
		},
		logError: () => {
			loggedError = true;
		},
	});

	await shutdown('SIGTERM');

	expect(calls).toEqual([
		'announce',
		`delay:${DRAIN_GRACE_MS}`,
		'flush',
		'closeSessions',
		'close',
		'exit:0',
	]);
	expect(loggedError).toBe(true);
});

test('a throwing session close still closes the store and exits', async () => {
	const calls: string[] = [];
	const shutdown = recordedShutdown(calls, {
		closeSessions: () => {
			calls.push('closeSessions');
			throw new Error('socket already gone');
		},
		logError: () => {},
	});

	await shutdown('SIGTERM');

	expect(calls).toEqual([
		'announce',
		`delay:${DRAIN_GRACE_MS}`,
		'flush',
		'closeSessions',
		'close',
		'exit:0',
	]);
});

test('no progress loss: state flushed only at shutdown survives via close()', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'mmo-shutdown-'));
	const path = join(dir, 'state.sqlite');
	try {
		const store = openPlayerStore(path);
		const key = 'ssh-ed25519 AAAAtestkeyblob';

		const shutdown = createShutdown({
			announce: () => {},
			flushAll: () => store.save(key, richSave()),
			closeSessions: () => {},
			close: () => store.close(),
			delay: () => Promise.resolve(),
			exit: () => {},
			log: () => {},
		});
		await shutdown('SIGTERM');

		expect(existsSync(path)).toBe(true);

		const reopened = openPlayerStore(path);
		expect(reopened.load(key)).toEqual(richSave());
		reopened.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('draining the runtime announces the restart, then closes every session with the upgrade reason', () => {
	const stack = createStackScenario();
	const { client: first } = joinScenarioPlayer(stack, 'Neo');
	const { client: second } = joinScenarioPlayer(stack, 'Morpheus');
	stack.advanceTick();
	first.receive();
	second.receive();

	stack.announce('The server is restarting for an update — hang tight.');
	expect(first.take('notice').text).toContain('restarting for an update');
	expect(second.take('notice').text).toContain('restarting for an update');

	stack.closeSessions('Reconnect in a few moments.');
	expect(first.take('reject').reason).toBe('Reconnect in a few moments.');
	expect(second.take('reject').reason).toBe('Reconnect in a few moments.');
	expect(first.closed).toBe(true);
	expect(second.closed).toBe(true);
});
