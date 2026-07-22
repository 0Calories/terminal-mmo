import type { ServerRuntime } from './serverRuntime';

export interface InMemorySession {
	readonly sessionId: number;
	readonly closed: boolean;
	send(frame: Uint8Array): void;
	receive(): Uint8Array[];
	disconnect(): void;
}

export interface InMemoryServer {
	connect(): InMemorySession;
	advanceTick(): void;
}

export function createInMemoryServer(runtime: ServerRuntime): InMemoryServer {
	return {
		connect() {
			const frames: Uint8Array[] = [];
			let closed = false;
			let sessionId = 0;
			const disconnect = () => {
				if (closed) return;
				closed = true;
				runtime.disconnect(sessionId);
			};
			sessionId = runtime.connect({
				send: (frame) => frames.push(new Uint8Array(frame)),
				close: disconnect,
			});
			return {
				get sessionId() {
					return sessionId;
				},
				get closed() {
					return closed;
				},
				send(frame) {
					if (!closed) runtime.receive(sessionId, new Uint8Array(frame));
				},
				receive() {
					return frames.splice(0);
				},
				disconnect,
			};
		},
		advanceTick() {
			runtime.advanceTick();
		},
	};
}
