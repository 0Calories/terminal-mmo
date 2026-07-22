import { randomBytes } from 'node:crypto';

import { loadZones, spriteIds } from '@mmo/assets/meta';
import { NONCE_LEN } from '@mmo/core/persistence';
import { encodeServerMessage } from '@mmo/core/protocol';
import type { ServerWebSocket } from 'bun';
import { createServerRuntime, type ServerRuntime } from './runtime';
import { installShutdownHooks } from './shutdown';
import { openPlayerStore } from './store';

const PORT = Number(process.env.PORT) || Number(process.env.MMO_PORT) || 8080;
const SERVER_VERSION = process.env.MMO_VERSION ?? 'dev';
const TICK_RATE = 20;
const MS_PER_TICK = 1000 / TICK_RATE;
const MAX_CONNECTIONS = Number(process.env.MMO_MAX_CONN) || 200;
const MAX_PER_IP = Number(process.env.MMO_MAX_PER_IP) || 10;
const FLUSH_MS = Number(process.env.MMO_FLUSH_MS) || 30_000;

interface WsData {
	sessionId: number;
	ip: string;
	counted: boolean;
}

function clientIp(req: Request, server: Bun.Server<WsData>): string {
	const forwarded = req.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	return server.requestIP(req)?.address ?? 'unknown';
}

export function startBunHost(runtime: ServerRuntime) {
	let openConnections = 0;
	const perIp = new Map<string, number>();
	const server = Bun.serve<WsData>({
		port: PORT,
		fetch(req, host) {
			const upgraded = host.upgrade(req, {
				data: {
					sessionId: 0,
					ip: clientIp(req, host),
					counted: false,
				},
			});
			if (upgraded) return;
			const path = new URL(req.url).pathname;
			if (path === '/health') return Response.json(runtime.health());
			return new Response('terminal-mmo server — connect over WebSocket');
		},
		websocket: {
			open(ws) {
				const { ip } = ws.data;
				const ipCount = perIp.get(ip) ?? 0;
				if (openConnections >= MAX_CONNECTIONS) {
					rejectTransport(ws, 'Server is full — please try again shortly.');
					return;
				}
				if (ipCount >= MAX_PER_IP) {
					rejectTransport(ws, 'Too many connections from your network.');
					return;
				}
				openConnections++;
				perIp.set(ip, ipCount + 1);
				ws.data.counted = true;
				ws.data.sessionId = runtime.connect({
					send: (frame) => ws.send(frame),
					close: () => ws.close(),
				});
			},
			message(ws, message) {
				const frame =
					typeof message === 'string'
						? new TextEncoder().encode(message)
						: new Uint8Array(message);
				try {
					runtime.receive(ws.data.sessionId, frame);
				} catch (error) {
					console.error('bad frame from session', ws.data.sessionId, error);
				}
			},
			close(ws) {
				const { sessionId, ip, counted } = ws.data;
				if (counted) {
					openConnections--;
					const count = (perIp.get(ip) ?? 1) - 1;
					if (count <= 0) perIp.delete(ip);
					else perIp.set(ip, count);
				}
				if (sessionId !== 0) runtime.disconnect(sessionId);
				console.log(`session ${sessionId} left`);
			},
		},
	});

	setInterval(() => runtime.advanceTick(), MS_PER_TICK);
	setInterval(() => runtime.flush(), FLUSH_MS);
	installShutdownHooks({
		flushAll: () => runtime.flush(),
		close: () => runtime.close(),
	});

	console.log(
		`@mmo/server (${SERVER_VERSION}) ticking the world at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
	);
	return server;
}

function rejectTransport(ws: ServerWebSocket<WsData>, reason: string): void {
	try {
		ws.send(encodeServerMessage({ t: 'reject', reason }));
	} catch {}
	ws.close();
}

if (import.meta.main) {
	const runtime = createServerRuntime({
		zones: loadZones(),
		store: openPlayerStore(process.env.MMO_DB_PATH ?? 'mmo-state.sqlite'),
		releaseVersion: SERVER_VERSION,
		nonce: () => new Uint8Array(randomBytes(NONCE_LEN)),
		validHatIds: spriteIds('hats'),
		validFormIds: spriteIds('forms'),
		tickRate: TICK_RATE,
	});
	startBunHost(runtime);
}
