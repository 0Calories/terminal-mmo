// Clean-shutdown hook for the long-lived server (#269). The store's `close()` is never called
// by the always-on process, so a SIGTERM (Railway redeploy) or SIGINT (Ctrl-C) between flushes
// would lose everything since the last one. The flush + close sequence is factored out of the
// signal plumbing so it is unit-testable, and guarded to run at most once — a second signal
// must not double-close the store.

export interface ShutdownDeps {
	// Persist every online Avatar's dirty durable state — the server's periodic `flushAll`.
	flushAll: () => void;
	// Release the store handle (checkpoints the sqlite WAL to the main db file).
	close: () => void;
	// Injectable for tests; defaults to the real process/console at install time.
	exit?: (code: number) => void;
	log?: (msg: string) => void;
	logError?: (msg: string, err: unknown) => void;
}

// The idempotent shutdown routine: flush, close the store, exit 0. flush and close are each
// wrapped so one throwing doesn't strand the other — a bad save must not skip the WAL
// checkpoint or the exit, because the latched guard would then swallow the follow-up SIGTERM
// and lose everything to the orchestrator's SIGKILL. Best-effort: save what we can and leave.
export function createShutdown(deps: ShutdownDeps): (signal: string) => void {
	const exit = deps.exit ?? ((code: number) => process.exit(code));
	const log = deps.log ?? ((msg: string) => console.log(msg));
	const logError =
		deps.logError ?? ((msg: string, err: unknown) => console.error(msg, err));
	let done = false;
	return (signal: string) => {
		if (done) return; // already shutting down — ignore the repeat signal
		done = true;
		log(`received ${signal} — flushing player state and closing store`);
		try {
			deps.flushAll();
		} catch (err) {
			logError('shutdown flush failed — closing store anyway', err);
		}
		try {
			deps.close();
		} catch (err) {
			logError('shutdown store close failed', err);
		}
		exit(0);
	};
}

// Register on SIGTERM (orchestrated stop / redeploy) and SIGINT (Ctrl-C). They share one
// guarded shutdown, so whichever signal arrives first wins and the other is a no-op.
export function installShutdownHooks(deps: ShutdownDeps): void {
	const shutdown = createShutdown(deps);
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
