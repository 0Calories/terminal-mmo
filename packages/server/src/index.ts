// @mmo/server — the M2 authoritative server (ADR 0006). One Bun WebSocket
// endpoint runs the shared multi-Zone world: a Field and a Town, each ticking its
// own simulation at ~20 Hz over binary frames. The server owns every consequence
// (Monster AI/HP, hit resolution, Avatar HP / death / respawn, loot, XP) and which
// Zone each session occupies (#33), but never simulates Avatar physics from input
// — it trusts the client-reported position (loose bounds clamp only), per ADR 0001.

import { randomBytes } from 'node:crypto';
import {
	type AvatarIntent,
	addSession,
	applySell,
	CHAT_MAX_LEN,
	type Cosmetics,
	canonicalPublicKey,
	createServerWorld,
	decodeClientMessage,
	emoteById,
	emptySave,
	encodeServerMessage,
	handleOf,
	isReleaseVersion,
	loadZones,
	NONCE_LEN,
	parsePublicKeyLine,
	registryFromSaves,
	removeSession,
	resolveAuth,
	restoredFromSave,
	type ServerWorld,
	saveFromAvatar,
	sessionByHandle,
	sessionsInZone,
	stepServerWorld,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/shared';
import type { ServerWebSocket } from 'bun';
import { installShutdownHooks } from './shutdown';
import { openPlayerStore } from './store';

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
});

let nextSessionId = 1;
const sockets = new Map<number, ServerWebSocket<WsData>>(); // joined sessions
const intents = new Map<number, AvatarIntent>(); // latest reported intent

// Durable persistence (#236, ADR 0004 identity keys it): player state — level/XP/Gold,
// inventory + equipped Weapon, cosmetics, last Town, boss-defeated flag — lives in
// bun:sqlite behind the pure `PlayerStore` seam. The account registry (public key ↔
// durable Handle) is rebuilt from those saved rows on startup, so identities survive a
// restart; the pure `resolveAuth` seam is unchanged by that swap.
const store = openPlayerStore(process.env.MMO_DB_PATH ?? 'mmo-state.sqlite');
let accounts = registryFromSaves(store.all());
// How often to flush every online Avatar's durable state (never per-tick, ADR 0009 —
// significant events + this periodic sweep). Overridable for tests / tuning.
const FLUSH_MS = Number(process.env.MMO_FLUSH_MS) || 30_000;
// Connections that said hello and were issued a nonce, awaiting their `proof`.
interface PendingAuth {
	nonce: Uint8Array;
	publicKey: string;
	key: string; // canonicalPublicKey(publicKey), the identity/presence index
	handle: string;
	cosmetics: Cosmetics;
	weapon: number;
}
const pendingAuth = new Map<number, PendingAuth>();
// One presence per identity: the canonical public key of each ONLINE session
// (both directions, so `close` can release the key and a second login of the
// same key is refused while the first is connected).
const onlineKeyBySession = new Map<number, string>();
const onlineSessionByKey = new Map<string, number>();
// Body emotes triggered since the last tick (ADR 0020 §9), keyed by session. Consumed
// in `tick` by folding onto that session's intent as a one-shot edge — so the emote arms
// once instead of re-firing every input tick the way a sticky intent flag would.
const pendingEmotes = new Map<number, string>();

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
		// SSH-key auth (ADR 0004, #235): a parseable ed25519 key must be offered up
		// front, then the connection proves control of it before it joins the World.
		const pub = parsePublicKeyLine(msg.publicKey);
		if (!pub) {
			reject(
				ws,
				'An SSH ed25519 key is required to play — add one to ssh-agent or create ~/.ssh/id_ed25519 (ssh-keygen -t ed25519).',
			);
			return;
		}
		const nonce = new Uint8Array(randomBytes(NONCE_LEN));
		pendingAuth.set(sessionId, {
			nonce,
			publicKey: msg.publicKey,
			key: canonicalPublicKey(pub),
			handle: msg.handle,
			cosmetics: msg.cosmetics,
			weapon: msg.weapon,
		});
		ws.send(encodeServerMessage({ t: 'challenge', nonce }));
		return;
	}
	if (msg.t === 'proof') {
		const pending = pendingAuth.get(sessionId);
		if (!pending) return; // proof before hello (or a duplicate); ignore
		pendingAuth.delete(sessionId);
		const auth = resolveAuth(
			accounts,
			pending.publicKey,
			pending.nonce,
			msg.signature,
			pending.handle,
		);
		if (!auth.ok) {
			reject(ws, auth.reason);
			return;
		}
		// One presence per identity: the same key connecting twice would put one
		// durable Handle in the World twice, so the newcomer is refused.
		const key = pending.key;
		if (onlineSessionByKey.has(key)) {
			reject(
				ws,
				`"${auth.handle}" is already online — disconnect the other session first.`,
			);
			return;
		}
		accounts = auth.registry;
		onlineKeyBySession.set(sessionId, key);
		onlineSessionByKey.set(key, sessionId);
		// Load the durable save keyed by this account (#236). A first-ever login has none:
		// mint an empty save and persist it immediately so the Handle claim survives a
		// restart. A returning login is restored to its last Town with its saved level/XP/
		// Gold, inventory, equipped Weapon, cosmetics, and boss-defeated flag; the handshake
		// cosmetics/weapon are the fresh-account choice, overridden by the save when present.
		let saved = store.load(key);
		if (!saved) {
			// A fresh account keeps its connect-time cosmetics/Weapon choice (the handshake
			// picker), persisted from the start so it survives a restart.
			saved = {
				...emptySave(auth.handle, TOWN_ZONE),
				cosmetics: pending.cosmetics,
				equippedWeapon: pending.weapon,
			};
			store.save(key, saved);
		}
		world = addSession(
			world,
			sessionId,
			auth.handle,
			pending.cosmetics,
			pending.weapon,
			restoredFromSave(saved),
		);
		sockets.set(sessionId, ws);
		const zoneId = zoneOf(world, sessionId) ?? START_ZONE;
		ws.send(
			encodeServerMessage({
				t: 'welcome',
				sessionId,
				zoneId,
				tickRate: TICK_RATE,
				handle: auth.handle,
			}),
		);
		console.log(`session ${sessionId} (${auth.handle}) joined ${zoneId}`);
		return;
	}
	if (msg.t === 'chat') {
		// Relay a Zone-local line to every session in the sender's Zone (#34),
		// attributed to the sender's handshake handle. The sender is in its own
		// Zone, so it sees its own message echoed back.
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
		for (const sid of sessionsInZone(world, sessionId))
			sockets.get(sid)?.send(frame);
		return;
	}
	if (msg.t === 'whisper') {
		// A private, directed message routed world-wide to one online handle (#40) —
		// unlike chat, it crosses Zones. Both sender and recipient see it.
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
		// A body-emote trigger (ADR 0020 §9): no longer relayed as a fire-and-forget
		// event — it arms authoritative state on the Avatar that rides the next snapshot's
		// action-state, so a late arrival still sees a held/looping pose. Validate the id
		// and queue it; `tick` folds it into this session's intent (a one-shot edge, so it
		// fires once rather than every tick). An unknown id is dropped.
		if (!emoteById(msg.emote)) return;
		if (zoneStateOf(world, sessionId) === undefined) return; // emote before hello
		pendingEmotes.set(sessionId, msg.emote);
		return;
	}
	if (msg.t === 'sell') {
		// Server-authoritative economy (#267, ADR 0025): the whole rule is the pure
		// `applySell` — the seller must be at a Merchant, own the `itemId`, and the price is
		// re-derived server-side. A rejected sell (unowned id / not at a Merchant) is a
		// silent no-op; the next snapshot simply re-affirms the unchanged bag. A successful
		// sell is a significant durable event (Gold moved), so flush it immediately (#236)
		// instead of waiting for the periodic sweep.
		const res = applySell(world, sessionId, msg.itemId);
		if (res.sold) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	// input: trust the reported position with only a loose bounds clamp (against the
	// session's current Zone) — the server never re-simulates Avatar physics.
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
		guard: msg.guard,
		interact: msg.interact,
		dodge: msg.dodge,
		skill: msg.skill,
	});
}

// Persist one online Avatar's durable state (#236): lift its ServerAvatar to a PlayerSave
// and upsert it keyed by the account's canonical public key. Called on significant events
// (logout) and the periodic flush — never per-tick. A session with no account key (never
// happens post-auth) or no placed Avatar is skipped.
function flushSession(sessionId: number) {
	const key = onlineKeyBySession.get(sessionId);
	if (key === undefined) return;
	const sa = zoneStateOf(world, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
	if (sa === undefined) return;
	store.save(key, saveFromAvatar(sa, TOWN_ZONE));
}

// Periodic durable flush of every online Avatar (ADR 0009 cadence — not per-tick).
function flushAll() {
	for (const sessionId of sockets.keys()) flushSession(sessionId);
}

function tick() {
	// Fold any queued body emote onto its session's intent for this tick (ADR 0020 §9),
	// consuming it so it fires exactly once. A queued emote with no input this cycle waits
	// (input flows continuously at ~30 Hz), so it isn't dropped.
	const tickIntents = [...intents.values()].map((i) => {
		const em = pendingEmotes.get(i.sessionId);
		if (em === undefined) return i;
		pendingEmotes.delete(i.sessionId);
		return { ...i, emote: em };
	});
	// Snapshot each session's Zone before the step so we can detect a transition INTO a
	// Town this tick — reaching safety is a significant event (#236), a natural save point,
	// so we flush just those sessions. This fires only on a Zone change, never per-tick.
	const zoneBefore = new Map<number, string>();
	for (const sessionId of sockets.keys()) {
		const z = zoneOf(world, sessionId);
		if (z !== undefined) zoneBefore.set(sessionId, z);
	}
	world = stepServerWorld(world, tickIntents, MS_PER_TICK);
	for (const sessionId of sockets.keys()) {
		const now = zoneOf(world, sessionId);
		if (
			now !== undefined &&
			now !== zoneBefore.get(sessionId) &&
			world.templates[now].type === 'town'
		)
			flushSession(sessionId);
	}
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
			// Logout is a significant event (#236): flush this Avatar's durable state
			// before it leaves the World, so nothing since the last periodic flush is lost.
			flushSession(sessionId);
			sockets.delete(sessionId);
			intents.delete(sessionId);
			pendingEmotes.delete(sessionId);
			pendingAuth.delete(sessionId);
			// Release this identity's presence so the key can log in again (#235).
			const key = onlineKeyBySession.get(sessionId);
			if (key !== undefined) {
				onlineKeyBySession.delete(sessionId);
				onlineSessionByKey.delete(key);
			}
			world = removeSession(world, sessionId);
			console.log(`session ${sessionId} left`);
		},
	},
});

setInterval(tick, MS_PER_TICK);
setInterval(flushAll, FLUSH_MS);

// Clean shutdown (#269): on SIGTERM (Railway redeploy) or SIGINT (Ctrl-C) flush every online
// Avatar's dirty state and close the store before exit, so nothing since the last periodic
// flush — or the per-event flushes from logout / Town-entry / a sell (#267) — is lost. The
// hook is idempotent, so a repeated / racing signal never double-closes the store.
installShutdownHooks({ flushAll, close: () => store.close() });

console.log(
	`@mmo/server (${SERVER_VERSION}) ticking the world at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
);
