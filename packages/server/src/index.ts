import { randomBytes } from 'node:crypto';
// The server's sole door into asset content (ADR 0033): ids/roles/zone-list.
// Sprite text and art code stay unreachable; depcruise enforces the boundary.
import { loadZones, spriteIds } from '@mmo/assets/meta';
import {
	type Cosmetics,
	emoteById,
	sanitizeFormId,
	sanitizeHatId,
} from '@mmo/core/entities';
import {
	canonicalPublicKey,
	claimHandle,
	NONCE_LEN,
	parsePublicKeyLine,
	registryFromSaves,
	resolveAuth,
	restoredFromSave,
	saveFromAvatar,
	validHandle,
} from '@mmo/core/persistence';
import {
	CHAT_MAX_LEN,
	type ClientMessage,
	decodeClientMessage,
	encodeServerMessage,
	isReleaseVersion,
} from '@mmo/core/protocol';
import {
	addSession,
	applyBuy,
	applyCosmetics,
	applySell,
	createServerWorld,
	handleOf,
	removeSession,
	type ServerWorld,
	sessionByHandle,
	sessionsInZone,
	spawnNewAvatar,
	stepServerWorld,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '@mmo/core/world';
import type { AvatarIntent } from '@mmo/core/zones';
import type { ServerWebSocket } from 'bun';
import { foldPendingEdges } from './intents';
import { installShutdownHooks } from './shutdown';
import { openPlayerStore } from './store';

const PORT = Number(process.env.PORT) || Number(process.env.MMO_PORT) || 8080;

const SERVER_VERSION = process.env.MMO_VERSION ?? 'dev';
const TICK_RATE = 20;
const MS_PER_TICK = 1000 / TICK_RATE;

// Both caps are SOFT: X-Forwarded-For is spoofable.
const MAX_CONNECTIONS = Number(process.env.MMO_MAX_CONN) || 200;
const MAX_PER_IP = Number(process.env.MMO_MAX_PER_IP) || 10;

interface WsData {
	sessionId: number;
	ip: string;
	counted: boolean;
}

// Socket accounting for the caps, not the joined `sockets` (a socket can sit open pre-handshake).
let openConnections = 0;
const perIp = new Map<string, number>();

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

// Set-membership validation is the server's job (core only shapes the type);
// computed once at startup from @mmo/assets/meta. Any hat or form id not in
// the set sanitizes to the default; the default Form ('buddy') ships as
// sprites/forms/buddy.sprite, so it is a member of the set.
const validHatIds: ReadonlySet<string> = spriteIds('hats');
const validFormIds: ReadonlySet<string> = spriteIds('forms');

function withValidCosmetics(c: Cosmetics): Cosmetics {
	return {
		...c,
		hat: sanitizeHatId(c.hat, validHatIds),
		form: sanitizeFormId(c.form, validFormIds),
	};
}

const START_ZONE = 'town-01';
const TOWN_ZONE = 'town-01';
let world: ServerWorld = createServerWorld({
	zones: loadZones(),
	start: START_ZONE,
	town: TOWN_ZONE,
});

let nextSessionId = 1;
const sockets = new Map<number, ServerWebSocket<WsData>>();
const intents = new Map<number, AvatarIntent>();

const store = openPlayerStore(process.env.MMO_DB_PATH ?? 'mmo-state.sqlite');
let accounts = registryFromSaves(store.all());
const FLUSH_MS = Number(process.env.MMO_FLUSH_MS) || 30_000;
interface PendingAuth {
	nonce: Uint8Array;
	publicKey: string;
	key: string;
	handle: string;
	cosmetics: Cosmetics;
	weapon: number;
}
const pendingAuth = new Map<number, PendingAuth>();
const onlineKeyBySession = new Map<number, string>();
const onlineSessionByKey = new Map<string, number>();
// New accounts authenticated but not yet spawned: held unplaced until `createAvatar`.
interface PendingSpawn {
	key: string;
	publicKey: string;
	handle: string;
	weapon: number;
}
const pendingSpawn = new Map<number, PendingSpawn>();
const pendingEmotes = new Map<number, string>();
// One-shot edge, not a sticky flag: a held flag would re-fire the Portal every tick, or be missed by the 20 Hz sampling.
const pendingInteract = new Set<number>();

const clamp = (v: number, hi: number) =>
	Number.isFinite(v) ? Math.max(0, Math.min(v, hi)) : 0;

function onMessage(ws: ServerWebSocket<WsData>, raw: Uint8Array) {
	let msg: ClientMessage;
	try {
		msg = decodeClientMessage(raw);
	} catch (err) {
		console.error('bad frame from session', ws.data.sessionId, err);
		return;
	}
	const { sessionId } = ws.data;
	if (msg.t === 'hello') {
		if (isReleaseVersion(SERVER_VERSION) && msg.version !== SERVER_VERSION) {
			reject(
				ws,
				`Your client is out of date — run \`bunx terminal-mmo@latest\` (server ${SERVER_VERSION}, your client ${msg.version || 'unknown'}).`,
			);
			return;
		}
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
			cosmetics: withValidCosmetics(msg.cosmetics),
			weapon: msg.weapon,
		});
		ws.send(encodeServerMessage({ t: 'challenge', nonce }));
		return;
	}
	if (msg.t === 'proof') {
		const pending = pendingAuth.get(sessionId);
		if (!pending) return;
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
		// The Save lookup — never a client flag — is the sole authority on new-vs-returning.
		const saved = store.load(key);
		if (saved) {
			const restored = restoredFromSave(saved);
			world = addSession(
				world,
				sessionId,
				auth.handle,
				pending.cosmetics,
				pending.weapon,
				{
					...restored,
					cosmetics: withValidCosmetics(restored.cosmetics),
				},
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
		const pending = pendingSpawn.get(sessionId);
		if (!pending) return;
		const desired = msg.handle.trim() || pending.handle;
		if (!validHandle(desired)) {
			ws.send(encodeServerMessage({ t: 'createRejected', reason: 'invalid' }));
			return;
		}
		const claim = claimHandle(accounts, pending.publicKey, desired);
		if (!claim.ok) {
			ws.send(
				encodeServerMessage({ t: 'createRejected', reason: claim.reason }),
			);
			return;
		}
		accounts = claim.registry;
		pendingSpawn.delete(sessionId);
		const { world: next, save } = spawnNewAvatar(
			world,
			sessionId,
			claim.handle,
			withValidCosmetics(msg.cosmetics),
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
		const res = applyCosmetics(
			world,
			sessionId,
			withValidCosmetics(msg.cosmetics),
		);
		if (res.changed) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	if (msg.t === 'chat') {
		const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
		if (!text) return;
		const me = zoneStateOf(world, sessionId)?.avatars.find(
			(a) => a.sessionId === sessionId,
		);
		if (me === undefined) return;
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
		const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
		if (!text) return;
		const from = handleOf(world, sessionId);
		if (from === undefined) return;
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
		const to = handleOf(world, target) ?? msg.to;
		const frame = encodeServerMessage({
			t: 'whisper',
			fromSessionId: sessionId,
			from,
			to,
			text,
		});
		sockets.get(target)?.send(frame);
		if (target !== sessionId) sockets.get(sessionId)?.send(frame);
		return;
	}
	if (msg.t === 'emote') {
		if (!emoteById(msg.emote)) return;
		if (zoneStateOf(world, sessionId) === undefined) return;
		pendingEmotes.set(sessionId, msg.emote);
		return;
	}
	if (msg.t === 'sell') {
		const res = applySell(world, sessionId, msg.itemId);
		if (res.sold) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	if (msg.t === 'buy') {
		const res = applyBuy(world, sessionId, msg.index);
		if (res.bought) {
			world = res.world;
			flushSession(sessionId);
		}
		return;
	}
	// input: the server trusts the reported position with only a loose bounds clamp — it never re-simulates physics.
	const zs = zoneStateOf(world, sessionId);
	if (zs === undefined) return;
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
		interact: false,
		dodge: msg.dodge,
		skill: msg.skill,
	});
	if (msg.interact) pendingInteract.add(sessionId);
}

function flushSession(sessionId: number) {
	const key = onlineKeyBySession.get(sessionId);
	if (key === undefined) return;
	const sa = zoneStateOf(world, sessionId)?.avatars.find(
		(a) => a.sessionId === sessionId,
	);
	if (sa === undefined) return;
	store.save(key, saveFromAvatar(sa, TOWN_ZONE));
}

function flushAll() {
	for (const sessionId of sockets.keys()) flushSession(sessionId);
}

function tick() {
	const tickIntents = foldPendingEdges(
		intents.values(),
		pendingEmotes,
		pendingInteract,
	);
	// Snapshot each Zone before the step to detect a transition INTO a Town this tick (a save point).
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

// Idempotent for an unknown session.
function dropSession(sessionId: number) {
	flushSession(sessionId);
	sockets.delete(sessionId);
	intents.delete(sessionId);
	pendingEmotes.delete(sessionId);
	pendingInteract.delete(sessionId);
	pendingAuth.delete(sessionId);
	pendingSpawn.delete(sessionId);
	const key = onlineKeyBySession.get(sessionId);
	if (key !== undefined) {
		onlineKeyBySession.delete(sessionId);
		onlineSessionByKey.delete(key);
	}
	world = removeSession(world, sessionId);
}

function currentWorld(): ServerWorld {
	return world;
}

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
			const path = new URL(req.url).pathname;
			if (path === '/health')
				return Response.json({ status: 'ok', version: SERVER_VERSION });
			return new Response('terminal-mmo server — connect over WebSocket');
		},
		websocket: {
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
				if (counted) {
					openConnections--;
					const n = (perIp.get(ip) ?? 1) - 1;
					if (n <= 0) perIp.delete(ip);
					else perIp.set(ip, n);
				}
				dropSession(sessionId);
				console.log(`session ${sessionId} left`);
			},
		},
	});

	setInterval(tick, MS_PER_TICK);
	setInterval(flushAll, FLUSH_MS);

	installShutdownHooks({ flushAll, close: () => store.close() });

	console.log(
		`@mmo/server (${SERVER_VERSION}) ticking the world at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
	);
}

export { currentWorld, dropSession, onMessage };
