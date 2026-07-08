// @mmo/server — the M2 authoritative server (ADR 0006). The server owns every consequence
// but never simulates Avatar physics from input — it trusts the client-reported position
// (loose bounds clamp only) per ADR 0001.

import { randomBytes } from 'node:crypto';
import {
	type AvatarIntent,
	addSession,
	applyBuy,
	applyCosmetics,
	applySell,
	CHAT_MAX_LEN,
	type Cosmetics,
	canonicalPublicKey,
	claimHandle,
	createServerWorld,
	decodeClientMessage,
	emoteById,
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
	spawnNewAvatar,
	stepServerWorld,
	validHandle,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/shared';
import type { ServerWebSocket } from 'bun';
import { foldPendingEdges } from './intents';
import { installShutdownHooks } from './shutdown';
import { openPlayerStore } from './store';

// Railway injects PORT; MMO_PORT stays as a local-dev override (ADR 0009).
const PORT = Number(process.env.PORT) || Number(process.env.MMO_PORT) || 8080;

// The release Version (ADR 0012): unset means a dev server, which skips the version gate
// and admits any client. Reported at `/health` so the release pipeline can assert the right
// build went live before publishing the client.
const SERVER_VERSION = process.env.MMO_VERSION ?? 'dev';
const TICK_RATE = 20; // Hz (ADR 0002 / PRD cadence)
const MS_PER_TICK = 1000 / TICK_RATE;

// Connection caps (ADR 0009). The per-IP cap stays generous enough not to bounce shared
// NAT / CGNAT (many developers behind one IP). Both are SOFT — `X-Forwarded-For` is
// spoofable; real per-identity limits await the auth branch.
const MAX_CONNECTIONS = Number(process.env.MMO_MAX_CONN) || 200;
const MAX_PER_IP = Number(process.env.MMO_MAX_PER_IP) || 10;

interface WsData {
	sessionId: number;
	ip: string;
	// True once counted toward the caps, so `close` only decrements a socket it actually
	// admitted (a rejected one isn't).
	counted: boolean;
}

// Socket accounting for the caps, by open WebSocket — not the joined `sockets`, which only
// populate on `hello` (a socket can sit open pre-handshake).
let openConnections = 0;
const perIp = new Map<string, number>();

// The client's apparent IP behind Railway's proxy: the first `X-Forwarded-For` hop (the
// proxy hides the socket peer). Spoofable, hence soft.
function clientIp(req: Request, srv: Bun.Server<WsData>): string {
	const xff = req.headers.get('x-forwarded-for');
	if (xff) return xff.split(',')[0].trim();
	return srv.requestIP(req)?.address ?? 'unknown';
}

function reject(ws: ServerWebSocket<WsData>, reason: string) {
	try {
		ws.send(encodeServerMessage({ t: 'reject', reason }));
	} catch {}
	ws.close();
}

const START_ZONE = 'town-01'; // Players spawn into the safe hub, then portal out
const TOWN_ZONE = 'town-01';
let world: ServerWorld = createServerWorld({
	zones: loadZones(),
	start: START_ZONE,
	town: TOWN_ZONE,
});

let nextSessionId = 1;
const sockets = new Map<number, ServerWebSocket<WsData>>(); // joined sessions
const intents = new Map<number, AvatarIntent>(); // latest reported intent

// Durable persistence (#236): player state lives in bun:sqlite behind the pure `PlayerStore`
// seam. The account registry (public key ↔ Handle) is rebuilt from the saved rows on startup,
// so identities survive a restart (ADR 0004).
const store = openPlayerStore(process.env.MMO_DB_PATH ?? 'mmo-state.sqlite');
let accounts = registryFromSaves(store.all());
// How often to flush every online Avatar's durable state — never per-tick (ADR 0009).
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
// One presence per identity, both directions: so `close` can release the key and a second
// login of the same key is refused while the first is connected.
const onlineKeyBySession = new Map<number, string>();
const onlineSessionByKey = new Map<string, number>();
// New accounts authenticated but NOT yet spawned (#302, ADR 0028): the Save lookup found
// nothing, so the server holds them unplaced (no Avatar, never broadcast) while the client
// shows the creator. `createAvatar` consumes this to claim the Handle, mint the Save, and
// spawn; `close` drops it if they leave at the creator. `handle` is the auto-derived
// placeholder used when the Player leaves the field empty (#304).
interface PendingSpawn {
	key: string;
	publicKey: string;
	handle: string;
	weapon: number;
}
const pendingSpawn = new Map<number, PendingSpawn>();
// Body emotes triggered since the last tick (ADR 0020 §9). Consumed in `tick` as a one-shot
// edge, so the emote arms once instead of re-firing every input tick.
const pendingEmotes = new Map<number, string>();
// Portal/interact presses since the last tick (ADR 0027), same one-shot edge idiom as
// `pendingEmotes`. NOT a sticky intent flag: a held flag would re-fire the Portal each tick,
// or be missed when the 20 Hz tick fails to sample the ~33 ms it sat on the wire.
const pendingInteract = new Set<number>();

const clamp = (v: number, hi: number) =>
	Number.isFinite(v) ? Math.max(0, Math.min(v, hi)) : 0;

function onMessage(ws: ServerWebSocket<WsData>, raw: Uint8Array) {
	const msg = decodeClientMessage(raw);
	const { sessionId } = ws.data;
	if (msg.t === 'hello') {
		// Version gate (ADR 0012): a stale `bunx` client (cached against a newer server) is
		// refused loudly rather than left to mis-decode frames. A dev server (MMO_VERSION
		// unset) skips the gate and admits anyone.
		if (isReleaseVersion(SERVER_VERSION) && msg.version !== SERVER_VERSION) {
			reject(
				ws,
				`Your client is out of date — run \`bunx terminal-mmo@latest\` (server ${SERVER_VERSION}, your client ${msg.version || 'unknown'}).`,
			);
			return;
		}
		// SSH-key auth (ADR 0004, #235): a parseable ed25519 key up front, proven before the
		// connection joins the World.
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
		// The same key connecting twice would put one Handle in the World twice, so the
		// newcomer is refused.
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
		// The Save lookup — never a client flag — is the sole authority on new-vs-returning
		// (#302, ADR 0028). A returning account (Save present) is restored and spawned straight
		// into its last Town.
		const saved = store.load(key);
		if (saved) {
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
					isNew: false,
				}),
			);
			console.log(`session ${sessionId} (${auth.handle}) joined ${zoneId}`);
			return;
		}
		// A brand-new account (no Save): hold it authenticated but UNSPAWNED — kept out of
		// `sockets`, so it is never broadcast and gets no snapshot until `createAvatar` places
		// it. `welcome` reports `isNew` so the client shows the creator; the Save is minted
		// only on finalise.
		pendingSpawn.set(sessionId, {
			key,
			publicKey: pending.publicKey,
			handle: auth.handle,
			weapon: pending.weapon,
		});
		ws.send(
			encodeServerMessage({
				t: 'welcome',
				sessionId,
				zoneId: START_ZONE,
				tickRate: TICK_RATE,
				handle: auth.handle,
				isNew: true,
			}),
		);
		console.log(
			`session ${sessionId} (${auth.handle}) authenticated as a new account — awaiting createAvatar`,
		);
		return;
	}
	if (msg.t === 'createAvatar') {
		// Finalise a new account's creation (#302, ADR 0028): valid only for a session held
		// unspawned, so a stray/duplicate createAvatar is a silent no-op.
		const pending = pendingSpawn.get(sessionId);
		if (!pending) return;
		// The Handle is claimed HERE, not at the handshake (#304). An empty field falls back to
		// the auto-derived placeholder (re-applied server-side so an empty field is never claimed
		// literally). On failure the session stays HELD and `createRejected` lets the client retry.
		const desired = msg.handle.trim() || pending.handle;
		if (!validHandle(desired)) {
			ws.send(encodeServerMessage({ t: 'createRejected', reason: 'invalid' }));
			return;
		}
		const claim = claimHandle(accounts, pending.publicKey, desired);
		if (!claim.ok) {
			// `desired` already passed `validHandle` and the key owns no Handle yet, so the only
			// failure left is `taken`; keep the hold for a retry.
			ws.send(
				encodeServerMessage({ t: 'createRejected', reason: claim.reason }),
			);
			return;
		}
		accounts = claim.registry;
		pendingSpawn.delete(sessionId);
		// Spawn through the shared `spawnNewAvatar` seam, persist the Save immediately (the
		// Handle claim must survive a restart), then join `sockets` so the next tick broadcasts
		// the freshly placed Avatar.
		const { world: next, save } = spawnNewAvatar(
			world,
			sessionId,
			claim.handle,
			msg.cosmetics,
			pending.weapon,
			TOWN_ZONE,
		);
		world = next;
		store.save(pending.key, save);
		sockets.set(sessionId, ws);
		console.log(
			`session ${sessionId} (${claim.handle}) created and spawned into ${zoneOf(world, sessionId) ?? START_ZONE}`,
		);
		return;
	}
	if (msg.t === 'setCosmetics') {
		// In-game re-customization (#305, ADR 0028), gated on the Player standing in a Town: a
		// request from elsewhere (or a pre-spawn session) is a silent no-op. On success persist
		// immediately — the new look must survive a restart — and let the next snapshot rebroadcast.
		const res = applyCosmetics(world, sessionId, msg.cosmetics);
		if (res.changed) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	if (msg.t === 'chat') {
		// Relay a Zone-local line to every session in the sender's Zone (#34). The sender is in
		// its own Zone, so it sees its own message echoed back.
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
		// A private message routed world-wide to one handle (#40) — unlike chat, it crosses
		// Zones. Both sender and recipient see it.
		const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
		if (!text) return; // drop empty / whitespace-only whispers
		const from = handleOf(world, sessionId);
		if (from === undefined) return; // whisper before hello; ignore
		const target = sessionByHandle(world, msg.to);
		if (target === undefined) {
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
		// The sender always gets its own echo; whispering yourself (target === sessionId) sends
		// exactly one frame.
		if (target !== sessionId) sockets.get(sessionId)?.send(frame);
		return;
	}
	if (msg.t === 'emote') {
		// A body-emote trigger (ADR 0020 §9): arms authoritative state on the Avatar that rides
		// the next snapshot, so a late arrival still sees a held/looping pose. `tick` folds it
		// in as a one-shot edge; an unknown id is dropped.
		if (!emoteById(msg.emote)) return;
		if (zoneStateOf(world, sessionId) === undefined) return; // emote before hello
		pendingEmotes.set(sessionId, msg.emote);
		return;
	}
	if (msg.t === 'sell') {
		// Server-authoritative economy (#267, ADR 0025): the whole rule is the pure `applySell`.
		// A rejected sell is a silent no-op; a success moves Gold, so flush immediately (#236)
		// instead of waiting for the periodic sweep.
		const res = applySell(world, sessionId, msg.itemId);
		if (res.sold) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	if (msg.t === 'buy') {
		// Server-authoritative economy (#273, ADR 0025): the whole rule is the pure `applyBuy`.
		// A rejected buy is a silent no-op; a success moves Gold, so flush immediately (#236)
		// instead of waiting for the periodic sweep.
		const res = applyBuy(world, sessionId, msg.index);
		if (res.bought) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	// input: trust the reported position with only a loose bounds clamp — the server never
	// re-simulates Avatar physics.
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
		// `interact` rides the one-shot edge queue, NOT this sticky intent (ADR 0027) —
		// registered below and folded in once by `tick`.
		interact: false,
		dodge: msg.dodge,
		skill: msg.skill,
	});
	if (msg.interact) pendingInteract.add(sessionId);
}

// Persist one online Avatar's durable state (#236), keyed by the account's canonical public
// key. Called on significant events and the periodic flush — never per-tick. A session with
// no account key or no placed Avatar is skipped.
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
	// Fold queued emote (ADR 0020 §9) and interact (ADR 0027) edges onto this tick's intent,
	// each consumed so it fires once. A queued edge with no input this cycle waits — input
	// flows continuously at ~30 Hz — so it isn't dropped.
	const tickIntents = foldPendingEdges(
		intents.values(),
		pendingEmotes,
		pendingInteract,
	);
	// Snapshot each session's Zone before the step so we can detect a transition INTO a Town
	// this tick — reaching safety is a natural save point (#236), so we flush just those.
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

// Tear down a departed session's state (#236, #302): flush its durable Avatar, drop it from
// every per-session map, release its identity presence so the key can log in again (#235),
// and remove its Avatar from the World. Extracted from the `close` handler so the lifecycle
// is testable off a live socket. Idempotent for an unknown session.
function dropSession(sessionId: number) {
	flushSession(sessionId);
	sockets.delete(sessionId);
	intents.delete(sessionId);
	pendingEmotes.delete(sessionId);
	pendingInteract.delete(sessionId);
	pendingAuth.delete(sessionId);
	// A new account that left at the creator (authenticated but never spawned): drop its hold
	// so a reconnect starts clean.
	pendingSpawn.delete(sessionId);
	// Release this identity's presence so the key can log in again (#235).
	const key = onlineKeyBySession.get(sessionId);
	if (key !== undefined) {
		onlineKeyBySession.delete(sessionId);
		onlineSessionByKey.delete(key);
	}
	world = removeSession(world, sessionId);
}

// A read-only window onto the live World for tests: `world` is private and reassigned, so ES
// export bindings wouldn't read cleanly. #302's tests assert new accounts stay unspawned until
// `createAvatar`.
function currentWorld(): ServerWorld {
	return world;
}

// The bootstrap runs only when this module is the entrypoint: under test it is imported for
// the `onMessage`/`dropSession` seam, so the listener, tick loop, and shutdown hooks stay
// dormant (#302).
if (import.meta.main) {
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
			// `/health` also reports the release Version (ADR 0012): the pipeline polls it after
			// deploy and won't publish the client unless it matches the tag it just shipped.
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
				// Logout is a significant event (#236): flush and release presence before the
				// Avatar leaves the World, so nothing since the last periodic flush is lost.
				dropSession(sessionId);
				console.log(`session ${sessionId} left`);
			},
		},
	});

	setInterval(tick, MS_PER_TICK);
	setInterval(flushAll, FLUSH_MS);

	// Clean shutdown (#269): on SIGTERM (Railway redeploy) or SIGINT (Ctrl-C) flush every
	// online Avatar and close the store before exit, so nothing since the last flush is lost.
	installShutdownHooks({ flushAll, close: () => store.close() });

	console.log(
		`@mmo/server (${SERVER_VERSION}) ticking the world at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
	);
}

// Test surface (#302): not part of the wire/runtime contract — exported so a headless test
// can drive the handshake and prove a new account stays unspawned until `createAvatar`.
export { currentWorld, dropSession, onMessage };
