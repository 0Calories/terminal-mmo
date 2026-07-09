export interface ShutdownDeps {
	flushAll: () => void;
	close: () => void;
	exit?: (code: number) => void;
	log?: (msg: string) => void;
	logError?: (msg: string, err: unknown) => void;
}

// flush and close each wrapped so one throwing doesn't strand the other, or the latched guard swallows the follow-up SIGTERM.
export function createShutdown(deps: ShutdownDeps): (signal: string) => void {
	const exit = deps.exit ?? ((code: number) => process.exit(code));
	const log = deps.log ?? ((msg: string) => console.log(msg));
	const logError =
		deps.logError ?? ((msg: string, err: unknown) => console.error(msg, err));
	let done = false;
	return (signal: string) => {
		if (done) return;
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

export function installShutdownHooks(deps: ShutdownDeps): void {
	const shutdown = createShutdown(deps);
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
