// Clean-shutdown hook for the long-lived server (#269). The player store is flushed only
// periodically (ADR 0009 sweep) and on significant events (logout / Town-entry / a #267
// sell), and its `close()` is never called by the always-on process — so a SIGTERM (Railway
// redeploy) or SIGINT (Ctrl-C in dev) between flushes would lose everything since the last
// one. This installs a signal hook that flushes every online Avatar's dirty state and closes
// the store cleanly before the process exits, so a clean shutdown never drops progress.
//
// The flush + close sequence is factored out of the signal plumbing so it can be unit-tested
// without process machinery, and it is guarded to run at most once — a second signal (or
// SIGINT then SIGTERM) must not double-flush or, worse, double-close the store.

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

// Build the idempotent shutdown routine: flush all dirty player state, then close the store,
// then exit 0. A second invocation is a no-op, so racing / repeated signals never double-close.
//
// The flush and close are wrapped so one throwing does not strand the other: if `flushAll`
// throws on a single bad save, `close()` (the WAL checkpoint that makes the already-flushed
// rows durable) and the exit still run — the alternative is a stuck process that, because the
// guard has latched, would also swallow the follow-up SIGTERM and lose everything to the
// orchestrator's SIGKILL. Best-effort: save what we can, checkpoint, and leave.
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

// Register the shutdown routine on SIGTERM (orchestrated stop / redeploy) and SIGINT (Ctrl-C).
// `createShutdown`'s internal guard makes the two share one at-most-once shutdown, so whichever
// signal arrives first wins and the other is a no-op.
export function installShutdownHooks(deps: ShutdownDeps): void {
	const shutdown = createShutdown(deps);
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
