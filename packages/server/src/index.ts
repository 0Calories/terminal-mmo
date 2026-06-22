// @mmo/server — the M2 authoritative server (ADR 0006). One Bun WebSocket
// endpoint runs the shared multi-Zone world: a Field and a Town, each ticking its
// own simulation at ~20 Hz over binary frames. The server owns every consequence
// (Monster AI/HP, hit resolution, Avatar HP / death / respawn, loot, XP) and which
// Zone each session occupies (#33), but never simulates Avatar physics from input
// — it trusts the client-reported position (loose bounds clamp only), per ADR 0001.

import {
	type AvatarIntent,
	addSession,
	CHANNEL,
	CHAT_MAX_LEN,
	channelOf,
	createServerWorld,
	decodeClientMessage,
	emoteById,
	encodeServerMessage,
	handleOf,
	isReleaseVersion,
	loadZones,
	removeSession,
	type ServerWorld,
	sessionByHandle,
	sessionsInChannel,
	stepServerWorld,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/shared';
import type { ServerWebSocket } from 'bun';

// Railway injects PORT; MMO_PORT stays as a local-dev override (ADR 0009).
const PORT = Number(process.env.PORT) || Number(process.env.MMO_PORT) || 8080;

// This server's release Version (ADR 0012). The release pipeline sets MMO_VERSION
// on the Railway deploy; unset means a dev server, which skips the version gate
// (`isReleaseVersion` is false) and admits any client. Reported at `/health` so the
// pipeline can assert the right build went live before it publishes the client.
const SERVER_VERSION = process.env.MMO_VERSION ?? 'dev';
const TICK_RATE = 20; // Hz (ADR 0002 / PRD cadence)
const MS_PER_TICK = 1000 / TICK_RATE;

// Connection caps (ADR 0009). The global cap protects the single-threaded event
// loop from exhaustion; the per-IP cap blunts single-actor multi-connect floods
// while staying generous enough not to bounce shared NAT / CGNAT (many real
// developers behind one IP). Both are SOFT — `X-Forwarded-For` is spoofable;
// real per-identity limits await the auth branch.
const MAX_CONNECTIONS = Number(process.env.MMO_MAX_CONN) || 200;
const MAX_PER_IP = Number(process.env.MMO_MAX_PER_IP) || 10;

interface WsData {
	sessionId: number;
	ip: string;
	// True once this socket has been counted toward the caps, so `close` only
	// decrements connections it actually admitted (a capped/rejected socket isn't).
	counted: boolean;
}

// Live socket accounting for the caps, by the open WebSocket — not the joined
// sessions in `sockets`, which only populate on `hello` (a socket can sit open
// pre-handshake). Decremented in `close`.
let openConnections = 0;
const perIp = new Map<string, number>();

// The client's apparent IP behind Railway's proxy: the first hop of
// `X-Forwarded-For` (the proxy hides the socket peer). Spoofable, hence soft.
function clientIp(req: Request, srv: Bun.Server<WsData>): string {
	const xff = req.headers.get('x-forwarded-for');
	if (xff) return xff.split(',')[0].trim();
	return srv.requestIP(req)?.address ?? 'unknown';
}

// Refuse a socket with a human reason the client surfaces, then close it (ADR
// 0009). Used for both cap rejections and the protocol-version gate.
function reject(ws: ServerWebSocket<WsData>, reason: string) {
	try {
		ws.send(encodeServerMessage({ t: 'reject', reason }));
	} catch {}
	ws.close();
}

const START_ZONE = 'town-01'; // Players spawn into the safe hub, then portal out
const TOWN_ZONE = 'town-01';
let world: ServerWorld = createServerWorld({
	zones: loadZones(), // authored `.zone` content off disk (ADR 0008)
	start: START_ZONE,
	town: TOWN_ZONE,
	cap: CHANNEL.softCap,
});

let nextSessionId = 1;
const sockets = new Map<number, ServerWebSocket<WsData>>(); // joined sessions
const intents = new Map<number, AvatarIntent>(); // latest reported intent

const clamp = (v: number, hi: number) =>
	Number.isFinite(v) ? Math.max(0, Math.min(v, hi)) : 0;

function onMessage(ws: ServerWebSocket<WsData>, raw: Uint8Array) {
	const msg = decodeClientMessage(raw);
	const { sessionId } = ws.data;
	if (msg.t === 'hello') {
		// Version gate (ADR 0012): a deployed server admits a client only at its exact
		// release Version, so a stale `bunx` client (cached against a newer server) is
		// refused loudly rather than left to mis-decode frames. A dev server
		// (MMO_VERSION unset) skips the gate and admits anyone, so local dev is never
		// rejected.
		if (isReleaseVersion(SERVER_VERSION) && msg.version !== SERVER_VERSION) {
			reject(
				ws,
				`Your client is out of date — run \`bunx terminal-mmo@latest\` (server ${SERVER_VERSION}, your client ${msg.version || 'unknown'}).`,
			);
			return;
		}
		world = addSession(world, sessionId, msg.handle, msg.cosmetics);
		sockets.set(sessionId, ws);
		const zoneId = zoneOf(world, sessionId) ?? START_ZONE;
		ws.send(
			encodeServerMessage({
				t: 'welcome',
				sessionId,
				zoneId,
				tickRate: TICK_RATE,
			}),
		);
		console.log(
			`session ${sessionId} (${msg.handle}) joined ${zoneId} (ch ${channelOf(world, sessionId)})`,
		);
		return;
	}
	if (msg.t === 'chat') {
		// Relay a Zone-local line to every session in the sender's Channel (#34),
		// attributed to the sender's handshake handle. The sender is in its own
		// Channel, so it sees its own message echoed back.
		const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
		if (!text) return; // drop empty / whitespace-only lines
		const me = zoneStateOf(world, sessionId)?.avatars.find(
			(a) => a.sessionId === sessionId,
		);
		if (me === undefined) return; // chat before hello; ignore
		// `sessionId` keys the bubble to the sender's sprite client-side (#59).
		const frame = encodeServerMessage({
			t: 'chat',
			sessionId,
			handle: me.handle,
			text,
		});
		for (const sid of sessionsInChannel(world, sessionId))
			sockets.get(sid)?.send(frame);
		return;
	}
	if (msg.t === 'whisper') {
		// A private, directed message routed world-wide to one online handle (#40) —
		// unlike chat, it crosses Zones and Channels. Both sender and recipient see it.
		const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
		if (!text) return; // drop empty / whitespace-only whispers
		const from = handleOf(world, sessionId);
		if (from === undefined) return; // whisper before hello; ignore
		const target = sessionByHandle(world, msg.to);
		if (target === undefined) {
			// Graceful, sender-only feedback for an unknown / offline handle.
			ws.send(
				encodeServerMessage({
					t: 'notice',
					text: `No player named "${msg.to}" is online.`,
				}),
			);
			return;
		}
		// Echo the recipient's canonical handle (its real casing) back to the sender.
		const to = handleOf(world, target) ?? msg.to;
		const frame = encodeServerMessage({
			t: 'whisper',
			fromSessionId: sessionId,
			from,
			to,
			text,
		});
		sockets.get(target)?.send(frame);
		// The sender always gets its own echo, even when whispering itself (target
		// === sessionId sends one frame, which is the desired single echo).
		if (target !== sessionId) sockets.get(sessionId)?.send(frame);
		return;
	}
	if (msg.t === 'emote') {
		// Relay a Zone-local emote to every session in the sender's Channel (#38),
		// keyed to the sender's sprite. Drop an unknown id rather than relay it. Like
		// chat, the sender is in its own Channel, so it sees its own emote echoed back.
		if (!emoteById(msg.emote)) return;
		const me = zoneStateOf(world, sessionId)?.avatars.find(
			(a) => a.sessionId === sessionId,
		);
		if (me === undefined) return; // emote before hello; ignore
		const frame = encodeServerMessage({
			t: 'emote',
			sessionId,
			emote: msg.emote,
		});
		for (const sid of sessionsInChannel(world, sessionId))
			sockets.get(sid)?.send(frame);
		return;
	}
	// input: trust the reported position with only a loose bounds clamp (against the
	// session's current Zone/Channel) — the server never re-simulates Avatar physics.
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined) return; // input before hello; ignore
	const terrain = zs.zone.terrain;
	intents.set(sessionId, {
		sessionId,
		x: clamp(msg.x, terrain.w),
		y: clamp(msg.y, terrain.h),
		vx: msg.vx,
		vy: msg.vy,
		facing: msg.facing,
		onGround: msg.onGround,
		attack: msg.attack,
		interact: msg.interact,
		skill: msg.skill,
	});
}

function tick() {
	world = stepServerWorld(world, [...intents.values()], MS_PER_TICK);
	for (const [sessionId, ws] of sockets)
		ws.send(encodeServerMessage(worldSnapshotFor(world, sessionId)));
}

const server = Bun.serve<WsData>({
	port: PORT,
	fetch(req, srv) {
		const upgraded = srv.upgrade(req, {
			data: {
				sessionId: nextSessionId++,
				ip: clientIp(req, srv),
				counted: false,
			},
		});
		if (upgraded) return;
		// Any plain HTTP GET answers 200 so Railway's healthcheck passes (ADR 0009).
		// `/health` also reports this server's release Version (ADR 0012): the release
		// pipeline polls it after deploy and refuses to publish the client unless the
		// reported version matches the tag it just shipped.
		const path = new URL(req.url).pathname;
		if (path === '/health')
			return Response.json({ status: 'ok', version: SERVER_VERSION });
		return new Response('terminal-mmo server — connect over WebSocket');
	},
	websocket: {
		// Enforce the connection caps at the socket level, before any handshake.
		open(ws) {
			const { ip } = ws.data;
			const ipCount = perIp.get(ip) ?? 0;
			if (openConnections >= MAX_CONNECTIONS) {
				reject(ws, 'Server is full — please try again shortly.');
				return;
			}
			if (ipCount >= MAX_PER_IP) {
				reject(ws, 'Too many connections from your network.');
				return;
			}
			openConnections++;
			perIp.set(ip, ipCount + 1);
			ws.data.counted = true;
		},
		message(ws, message) {
			const bytes =
				typeof message === 'string'
					? new TextEncoder().encode(message)
					: new Uint8Array(message);
			try {
				onMessage(ws, bytes);
			} catch (err) {
				console.error('bad frame from session', ws.data.sessionId, err);
			}
		},
		close(ws) {
			const { sessionId, ip, counted } = ws.data;
			// Release the cap slot only if this socket was admitted (a rejected one
			// never incremented the counters).
			if (counted) {
				openConnections--;
				const n = (perIp.get(ip) ?? 1) - 1;
				if (n <= 0) perIp.delete(ip);
				else perIp.set(ip, n);
			}
			sockets.delete(sessionId);
			intents.delete(sessionId);
			world = removeSession(world, sessionId);
			console.log(`session ${sessionId} left`);
		},
	},
});

setInterval(tick, MS_PER_TICK);

console.log(
	`@mmo/server (${SERVER_VERSION}) ticking the world at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
);
