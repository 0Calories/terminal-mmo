export interface ShutdownDeps {
	announce: () => void;
	flushAll: () => void;
	closeSessions: () => void;
	close: () => void;
	graceMs?: number;
	delay?: (ms: number) => Promise<void>;
	exit?: (code: number) => void;
	log?: (msg: string) => void;
	logError?: (msg: string, err: unknown) => void;
}

// Must stay well inside Railway's stop grace window (~10s) or the drain is cut short by SIGKILL.
export const DRAIN_GRACE_MS = 3_000;

// Each step wrapped so one throwing doesn't strand the rest, or the latched guard swallows the follow-up SIGTERM.
export function createShutdown(
	deps: ShutdownDeps,
): (signal: string) => Promise<void> {
	const graceMs = deps.graceMs ?? DRAIN_GRACE_MS;
	const delay =
		deps.delay ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const exit = deps.exit ?? ((code: number) => process.exit(code));
	const log = deps.log ?? ((msg: string) => console.log(msg));
	const logError =
		deps.logError ?? ((msg: string, err: unknown) => console.error(msg, err));
	let done = false;
	return async (signal: string) => {
		if (done) return;
		done = true;
		log(
			`received ${signal} — announcing restart, draining for ${graceMs}ms, then flushing and closing`,
		);
		try {
			deps.announce();
		} catch (err) {
			logError('shutdown announce failed — flushing anyway', err);
		}
		try {
			await delay(graceMs);
		} catch (err) {
			logError('shutdown grace delay failed — flushing anyway', err);
		}
		try {
			deps.flushAll();
		} catch (err) {
			logError('shutdown flush failed — closing sessions anyway', err);
		}
		try {
			deps.closeSessions();
		} catch (err) {
			logError('shutdown session close failed — closing store anyway', err);
		}
		try {
			deps.close();
		} catch (err) {
			logError('shutdown store close failed', err);
		}
		exit(0);
	};
}

export function installShutdownHooks(deps: ShutdownDeps): void {
	const shutdown = createShutdown(deps);
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('SIGINT', () => void shutdown('SIGINT'));
}
