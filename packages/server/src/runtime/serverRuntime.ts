import type { Cosmetics } from '@mmo/core/entities';
import { emoteById, sanitizeFormId, sanitizeHatId } from '@mmo/core/entities';
import {
	type AccountRegistry,
	canonicalPublicKey,
	claimHandle,
	NONCE_LEN,
	type PlayerStore,
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
	avatarOf,
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
import type { AvatarIntent, Zone } from '@mmo/core/zones';
import { applyCosmetics } from '../cosmetics';
import { foldPendingEdges } from '../intents';
import { applyBuy, applySell } from '../vendor';

export interface RuntimeSession {
	send(frame: Uint8Array): void;
	close(): void;
}

export interface ServerRuntime {
	connect(session: RuntimeSession): number;
	receive(sessionId: number, frame: Uint8Array): void;
	advanceTick(): void;
	disconnect(sessionId: number): void;
	flush(): void;
	close(): void;
	health(): { status: 'ok'; version: string };
}

export interface ServerRuntimeOptions {
	zones: Zone[];
	store: PlayerStore;
	releaseVersion: string;
	nonce: () => Uint8Array;
	validHatIds: ReadonlySet<string>;
	validFormIds: ReadonlySet<string>;
	startZone?: string;
	townZone?: string;
	tickRate?: number;
	log?: (message: string) => void;
	logError?: (message: string, error: unknown) => void;
}

interface PendingAuth {
	nonce: Uint8Array;
	publicKey: string;
	key: string;
	handle: string;
	cosmetics: Cosmetics;
	weapon: number;
}

interface PendingSpawn {
	key: string;
	publicKey: string;
	handle: string;
	weapon: number;
}

const clamp = (value: number, high: number) =>
	Number.isFinite(value) ? Math.max(0, Math.min(value, high)) : 0;

export function createServerRuntime(
	options: ServerRuntimeOptions,
): ServerRuntime {
	const startZone = options.startZone ?? 'town-01';
	const townZone = options.townZone ?? 'town-01';
	const tickRate = options.tickRate ?? 20;
	const msPerTick = 1000 / tickRate;
	const log = options.log ?? ((message: string) => console.log(message));
	const logError =
		options.logError ??
		((message: string, error: unknown) => console.error(message, error));

	let world: ServerWorld = createServerWorld({
		zones: options.zones,
		start: startZone,
		town: townZone,
	});
	let accounts: AccountRegistry = registryFromSaves(options.store.all());
	let nextSessionId = 1;
	const sessions = new Map<number, RuntimeSession>();
	const spawnedSessions = new Set<number>();
	const intents = new Map<number, AvatarIntent>();
	const pendingAuth = new Map<number, PendingAuth>();
	const pendingSpawn = new Map<number, PendingSpawn>();
	const pendingEmotes = new Map<number, string>();
	const pendingInteract = new Set<number>();
	const onlineKeyBySession = new Map<number, string>();
	const onlineSessionByKey = new Map<string, number>();

	function withValidCosmetics(cosmetics: Cosmetics): Cosmetics {
		return {
			...cosmetics,
			hat: sanitizeHatId(cosmetics.hat, options.validHatIds),
			form: sanitizeFormId(cosmetics.form, options.validFormIds),
		};
	}

	function send(
		sessionId: number,
		message: Parameters<typeof encodeServerMessage>[0],
	) {
		sessions.get(sessionId)?.send(encodeServerMessage(message));
	}

	function reject(sessionId: number, reason: string): void {
		const session = sessions.get(sessionId);
		if (session === undefined) return;
		try {
			session.send(encodeServerMessage({ t: 'reject', reason }));
		} catch {}
		session.close();
	}

	function handleMessage(sessionId: number, msg: ClientMessage): void {
		if (msg.t === 'hello') {
			if (
				isReleaseVersion(options.releaseVersion) &&
				msg.version !== options.releaseVersion
			) {
				reject(
					sessionId,
					`Your client is out of date — run \`bunx terminal-mmo@latest\` (server ${options.releaseVersion}, your client ${msg.version || 'unknown'}).`,
				);
				return;
			}
			const publicKey = parsePublicKeyLine(msg.publicKey);
			if (!publicKey) {
				reject(
					sessionId,
					'An SSH ed25519 key is required to play — add one to ssh-agent or create ~/.ssh/id_ed25519 (ssh-keygen -t ed25519).',
				);
				return;
			}
			const nonce = new Uint8Array(options.nonce());
			if (nonce.length !== NONCE_LEN)
				throw new Error(
					`nonce source returned ${nonce.length} bytes, expected ${NONCE_LEN}`,
				);
			pendingAuth.set(sessionId, {
				nonce,
				publicKey: msg.publicKey,
				key: canonicalPublicKey(publicKey),
				handle: msg.handle,
				cosmetics: withValidCosmetics(msg.cosmetics),
				weapon: msg.weapon,
			});
			send(sessionId, { t: 'challenge', nonce });
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
				reject(sessionId, auth.reason);
				return;
			}
			if (onlineSessionByKey.has(pending.key)) {
				reject(
					sessionId,
					`"${auth.handle}" is already online — disconnect the other session first.`,
				);
				return;
			}
			accounts = auth.registry;
			onlineKeyBySession.set(sessionId, pending.key);
			onlineSessionByKey.set(pending.key, sessionId);

			const saved = options.store.load(pending.key);
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
				spawnedSessions.add(sessionId);
				const zoneId = zoneOf(world, sessionId) ?? startZone;
				send(sessionId, {
					t: 'welcome',
					sessionId,
					zoneId,
					tickRate,
					handle: auth.handle,
					isNew: false,
				});
				log(`session ${sessionId} (${auth.handle}) joined ${zoneId}`);
				return;
			}
			pendingSpawn.set(sessionId, {
				key: pending.key,
				publicKey: pending.publicKey,
				handle: auth.handle,
				weapon: pending.weapon,
			});
			send(sessionId, {
				t: 'welcome',
				sessionId,
				zoneId: startZone,
				tickRate,
				handle: auth.handle,
				isNew: true,
			});
			log(
				`session ${sessionId} (${auth.handle}) authenticated as a new account — awaiting createAvatar`,
			);
			return;
		}
		if (msg.t === 'createAvatar') {
			const pending = pendingSpawn.get(sessionId);
			if (!pending) return;
			const desired = msg.handle.trim() || pending.handle;
			if (!validHandle(desired)) {
				send(sessionId, { t: 'createRejected', reason: 'invalid' });
				return;
			}
			const claim = claimHandle(accounts, pending.publicKey, desired);
			if (!claim.ok) {
				send(sessionId, { t: 'createRejected', reason: claim.reason });
				return;
			}
			accounts = claim.registry;
			pendingSpawn.delete(sessionId);
			const spawned = spawnNewAvatar(
				world,
				sessionId,
				claim.handle,
				withValidCosmetics(msg.cosmetics),
				pending.weapon,
				townZone,
			);
			world = spawned.world;
			options.store.save(pending.key, spawned.save);
			spawnedSessions.add(sessionId);
			log(
				`session ${sessionId} (${claim.handle}) created and spawned into ${zoneOf(world, sessionId) ?? startZone}`,
			);
			return;
		}
		if (msg.t === 'setCosmetics') {
			const result = applyCosmetics(
				world,
				sessionId,
				withValidCosmetics(msg.cosmetics),
			);
			if (result.changed) {
				world = result.world;
				flushSession(sessionId);
			}
			return;
		}
		if (msg.t === 'chat') {
			const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
			if (!text) return;
			const handle = handleOf(world, sessionId);
			if (handle === undefined) return;
			const frame = encodeServerMessage({
				t: 'chat',
				sessionId,
				handle,
				text,
			});
			for (const targetId of sessionsInZone(world, sessionId))
				sessions.get(targetId)?.send(frame);
			return;
		}
		if (msg.t === 'whisper') {
			const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
			if (!text) return;
			const from = handleOf(world, sessionId);
			if (from === undefined) return;
			const target = sessionByHandle(world, msg.to);
			if (target === undefined) {
				send(sessionId, {
					t: 'notice',
					text: `No player named "${msg.to}" is online.`,
				});
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
			sessions.get(target)?.send(frame);
			if (target !== sessionId) sessions.get(sessionId)?.send(frame);
			return;
		}
		if (msg.t === 'emote') {
			if (!emoteById(msg.emote)) return;
			if (zoneStateOf(world, sessionId) === undefined) return;
			pendingEmotes.set(sessionId, msg.emote);
			return;
		}
		if (msg.t === 'sell') {
			const result = applySell(world, sessionId, msg.itemId);
			if (result.sold) {
				world = result.world;
				flushSession(sessionId);
			}
			return;
		}
		if (msg.t === 'buy') {
			const result = applyBuy(world, sessionId, msg.index);
			if (result.bought) {
				world = result.world;
				flushSession(sessionId);
			}
			return;
		}

		const zoneState = zoneStateOf(world, sessionId);
		if (zoneState === undefined) return;
		const terrain = zoneState.zone.terrain;
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

	function flushSession(sessionId: number): void {
		const key = onlineKeyBySession.get(sessionId);
		if (key === undefined) return;
		const avatar = avatarOf(world, sessionId);
		if (avatar === undefined) return;
		options.store.save(key, saveFromAvatar(avatar, townZone));
	}

	return {
		connect(session) {
			const sessionId = nextSessionId++;
			sessions.set(sessionId, session);
			return sessionId;
		},
		receive(sessionId, frame) {
			if (!sessions.has(sessionId)) return;
			let message: ClientMessage;
			try {
				message = decodeClientMessage(frame);
			} catch (error) {
				logError(`bad frame from session ${sessionId}`, error);
				return;
			}
			handleMessage(sessionId, message);
		},
		advanceTick() {
			const tickIntents = foldPendingEdges(
				intents.values(),
				pendingEmotes,
				pendingInteract,
			);
			const zoneBefore = new Map<number, string>();
			for (const sessionId of spawnedSessions) {
				const zone = zoneOf(world, sessionId);
				if (zone !== undefined) zoneBefore.set(sessionId, zone);
			}
			world = stepServerWorld(world, tickIntents, msPerTick);
			for (const sessionId of spawnedSessions) {
				const zone = zoneOf(world, sessionId);
				if (
					zone !== undefined &&
					zone !== zoneBefore.get(sessionId) &&
					world.templates[zone].type === 'town'
				)
					flushSession(sessionId);
			}
			for (const sessionId of spawnedSessions)
				send(sessionId, worldSnapshotFor(world, sessionId));
		},
		disconnect(sessionId) {
			if (!sessions.has(sessionId)) return;
			flushSession(sessionId);
			sessions.delete(sessionId);
			spawnedSessions.delete(sessionId);
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
		},
		flush() {
			for (const sessionId of spawnedSessions) flushSession(sessionId);
		},
		close() {
			options.store.close();
		},
		health() {
			return { status: 'ok', version: options.releaseVersion };
		},
	};
}
