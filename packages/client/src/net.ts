// Networked client transport (ADR 0006). The own Avatar is predicted locally for zero input
// lag; everything else — Monsters, Projectiles, own vitals/progress/inventory — renders from
// the server's authoritative snapshot.
import {
	type AvatarSnapshot,
	type ClientMessage,
	type Cosmetics,
	DEFAULT_COSMETICS,
	decodeServerMessage,
	type Entity,
	encodeClientMessage,
	type GameState,
	type Item,
	type MonsterSnapshot,
	type PlayerState,
	type ServerMessage,
	type Zone,
} from '@mmo/shared';
import { bubbleTtl } from './bubble';
import { INTERP_DELAY_MS, SnapshotBuffer } from './interp';
import type { SshIdentity } from './ssh-auth';
import { CLIENT_VERSION } from './version';

// A transient over-head Speech bubble: a sender's latest Chat line plus its remaining
// lifetime, decayed each frame (#59, ADR 0007).
export interface Bubble {
	text: string;
	ttl: number; // seconds remaining
}

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

// Cap the retained chat history; the HUD only shows the last few lines anyway.
const MAX_CHAT_LOG = 100;

export class NetClient {
	private ws: WebSocket;
	// Recent snapshots, kept so co-present entities render ~100 ms in the past, interpolated
	// between ticks (ADR 0006 cadence).
	private buffer = new SnapshotBuffer();
	sessionId = 0;
	zoneId = '';
	tickRate = 20;
	ready = false; // welcome received
	// The durable Handle this connection authenticated as (#235): a returning key may resolve
	// to a different Handle than requested. Seeded to the requested one so a pre-#235 server
	// (whose welcome carries none) still leaves it meaningful.
	handle: string;
	latest: Snapshot | null = null;
	// Zone-local chat lines (#34), bounded so an idle session can't accumulate them forever.
	chatLog: string[] = [];
	// Active over-head Speech bubbles, keyed by sender sessionId — one per sender, so a new
	// line replaces the prior text and resets the timer (#59, ADR 0007).
	bubbles = new Map<number, Bubble>();
	// Set when the server refuses the connection (Version mismatch, ADR 0012; or connection
	// cap, ADR 0009). The caller surfaces it and exits.
	rejected: string | null = null;
	// A `createAvatar` finalise refused for a taken/invalid Handle (#304, ADR 0028). Unlike
	// `onReject` this does NOT close the connection — the caller keeps the creator open and lets
	// the Player retry with another Handle.
	onCreateRejected: (reason: 'taken' | 'invalid') => void = () => {};
	// Fired once, when the FIRST snapshot arrives (the server has placed this Avatar). A new
	// account uses it to know its `createAvatar` landed and enter the World; a returning one
	// already started on `welcome`, so its handler is a harmless no-op.
	onSpawned: () => void = () => {};
	private spawnNotified = false;
	// The new-vs-returning verdict from `welcome`, retained so the spawn path knows whether to
	// fire the "signed in as" notice. A new account claims its Handle only at createAvatar,
	// AFTER `welcome`, so the notice is deferred to spawn and reads the claimed name off the
	// own Avatar snapshot (#317).
	private isNewAccount = false;

	constructor(
		url: string,
		handle: string,
		// Answers the server's auth challenge (ADR 0004, #235): its public key rides `hello`,
		// `signChallenge` produces the `proof`.
		private identity: Pick<SshIdentity, 'publicKey' | 'signChallenge'>,
		private onReject: (reason: string) => void = () => {},
		cosmetics: Cosmetics = DEFAULT_COSMETICS,
		weapon = 0,
		// The new-vs-returning verdict from `welcome` (#302, ADR 0028): the caller shows the
		// Avatar creator when `isNew`, else plays straight into the restored World. Optional so
		// headless/test callers can omit it.
		private onWelcome: (isNew: boolean) => void = () => {},
	) {
		this.handle = handle;
		this.ws = new WebSocket(url);
		this.ws.binaryType = 'arraybuffer';
		this.ws.onopen = () => {
			this.ws.send(
				encodeClientMessage({
					t: 'hello',
					handle,
					version: CLIENT_VERSION,
					cosmetics,
					// The chosen Weapon rides the connect handshake so every client sees it the
					// moment this Avatar spawns (ADR 0017 §14).
					weapon,
					publicKey: this.identity.publicKey,
				}),
			);
		};
		this.ws.onmessage = (ev) => {
			const msg = decodeServerMessage(new Uint8Array(ev.data as ArrayBuffer));
			this.ingest(msg, performance.now());
		};
		// Swallow connection errors: they just mean no fresh snapshots, and an unhandled error
		// event would tear the process down.
		this.ws.onerror = () => {};
	}

	// Apply a decoded server message. `recvTimeMs` is the local receipt clock, passed in by the
	// caller so the buffer never reads a clock itself and stays deterministically testable.
	ingest(msg: ServerMessage, recvTimeMs: number) {
		// The auth challenge (ADR 0004, #235): sign the nonce, answer with the proof. Sent directly
		// on the socket, not via send() — signing is async and this is pre-welcome, so the send()
		// ready-gate isn't open yet.
		if (msg.t === 'challenge') {
			this.identity.signChallenge(msg.nonce).then(
				(signature) => {
					if (this.ws.readyState === WebSocket.OPEN)
						this.ws.send(encodeClientMessage({ t: 'proof', signature }));
				},
				(err) => {
					this.rejected = String(err instanceof Error ? err.message : err);
					this.onReject(this.rejected);
					this.close();
				},
			);
			return;
		}
		if (msg.t === 'welcome') {
			this.sessionId = msg.sessionId;
			this.zoneId = msg.zoneId;
			this.tickRate = msg.tickRate;
			this.isNewAccount = msg.isNew;
			// '' only from a pre-#235 server; the requested handle stays then.
			if (msg.handle) {
				this.handle = msg.handle;
				// A returning key may resolve to a different Handle than this launch asked for
				// (#235). For a NEW account `welcome` precedes the Player claiming their Handle, so
				// `msg.handle` is still the auto-derived handshake name — defer to the spawn path
				// once the claimed name is known (#317).
				if (!msg.isNew) this.signedInAs(msg.handle);
			}
			this.ready = true;
			// Fire the verdict AFTER `ready` flips, so a `createAvatar` sent from the callback passes
			// the send() gate (#302).
			this.onWelcome(msg.isNew);
			return;
		}
		if (msg.t === 'reject') {
			this.rejected = msg.reason;
			this.onReject(msg.reason);
			return;
		}
		if (msg.t === 'chat') {
			this.pushChat(`${msg.handle}: ${msg.text}`);
			// Open / replace the sender's bubble (#59).
			this.bubbles.set(msg.sessionId, {
				text: msg.text,
				ttl: bubbleTtl(msg.text.length),
			});
			return;
		}
		// A private whisper (#40): our own echo reads "you → them", an inbound one "them → you".
		// Private, so it opens NO over-head bubble.
		if (msg.t === 'whisper') {
			const line =
				msg.fromSessionId === this.sessionId
					? `[you → ${msg.to}] ${msg.text}`
					: `[${msg.from} → you] ${msg.text}`;
			this.pushChat(line);
			return;
		}
		// A sender-only system line (#40), e.g. whispering an offline handle.
		if (msg.t === 'notice') {
			this.notice(msg.text);
			return;
		}
		// Handle refused at the createAvatar finalise (#304): the connection stays open so the
		// caller can surface the reason and let the Player retry.
		if (msg.t === 'createRejected') {
			this.onCreateRejected(msg.reason);
			return;
		}
		// snapshot: on a Zone change, drop the prior Zone's frames — interpolating
		// across the boundary would ease an Avatar between two unrelated coord spaces.
		if (msg.zoneId !== this.zoneId) {
			this.zoneId = msg.zoneId;
			this.buffer = new SnapshotBuffer();
		}
		this.latest = msg;
		this.buffer.push(msg, recvTimeMs);
		// First snapshot = the server has spawned this Avatar; tell the caller once so a held new
		// account can enter the World.
		if (!this.spawnNotified) {
			this.spawnNotified = true;
			// A new account's "signed in as" notice was deferred from `welcome` until now: the
			// Handle is claimed only once createAvatar lands, so read the claimed name off the own
			// Avatar snapshot rather than the pre-claim handshake name (#317).
			if (this.isNewAccount) {
				const claimed = this.ownAvatar()?.handle;
				if (claimed) this.signedInAs(claimed);
			}
			this.onSpawned();
		}
	}

	// The Zone view at local time `nowMs`: co-present entities are eased INTERP_DELAY_MS into the
	// past for smooth motion between 20 Hz ticks. The own Avatar is replaced downstream by local
	// prediction.
	sample(nowMs: number): Snapshot | null {
		return this.buffer.sample(nowMs - INTERP_DELAY_MS);
	}

	private pushChat(line: string) {
		this.chatLog.push(line);
		if (this.chatLog.length > MAX_CHAT_LOG)
			this.chatLog.splice(0, this.chatLog.length - MAX_CHAT_LOG);
	}

	// A local system line in the chat log (e.g. a bad `/w` usage), styled like a server notice —
	// no round-trip (#40).
	notice(text: string) {
		this.pushChat(`* ${text}`);
	}

	// The login identity line, surfaced once per session: from `welcome` for a returning account
	// (name known up front), from the spawn path for a new one (claimed name known only after
	// createAvatar lands) — one wording for both (#235, #317).
	private signedInAs(name: string) {
		this.notice(`signed in as ${name}`);
	}

	// Age each Speech bubble by `dtSec` and drop the expired. Called from the frame callback so
	// timing follows real elapsed time, not tick count (#59).
	decayBubbles(dtSec: number) {
		for (const [id, b] of this.bubbles) {
			b.ttl -= dtSec;
			if (b.ttl <= 0) this.bubbles.delete(id);
		}
	}

	send(msg: ClientMessage) {
		if (this.ready && this.ws.readyState === WebSocket.OPEN)
			this.ws.send(encodeClientMessage(msg));
	}

	close() {
		try {
			this.ws.close();
		} catch {}
	}

	ownAvatar() {
		return this.latest?.avatars.find((a) => a.sessionId === this.sessionId);
	}
}

// A co-present Avatar reshaped as a renderable Entity. `speed`/`attackT` stay 0 (physics and
// the swing timer are the server's); the replicated `action` carries the swing so the renderer
// draws this Avatar's pose + slash-arc — others' attacks are visible (ADR 0017 §10).
function avatarEntity(a: AvatarSnapshot): Entity {
	return {
		id: a.sessionId,
		type: 'player',
		name: a.handle,
		cosmetics: a.cosmetics,
		// The renderer composites this Avatar's weapon sprite at the grip — what makes another
		// Player's weapon visible.
		weapon: a.weapon,
		x: a.x,
		y: a.y,
		vx: a.vx,
		vy: a.vy,
		speed: 0,
		facing: a.facing,
		onGround: a.onGround,
		hp: a.hp,
		maxHp: a.maxHp,
		hurtT: a.hurtT,
		attackT: 0,
		action: a.action,
	};
}

function monsterEntity(m: MonsterSnapshot): Entity {
	return {
		id: m.id,
		type: m.type,
		x: m.x,
		y: m.y,
		vx: m.vx,
		vy: m.vy,
		speed: 0, // unused by the renderer; physics is server-side
		facing: m.facing,
		onGround: m.onGround,
		hp: m.hp,
		maxHp: m.maxHp,
		hurtT: m.hurtT,
		attackT: 0,
		action: m.action,
	};
}

/**
 * Reassemble a `GameState` the playfield/HUD can render: the static Field plus the snapshot's
 * authoritative Monsters/Projectiles and the locally-predicted own Avatar carrying server-owned
 * vitals. `localSkillCooldowns` are client-predicted (not on the wire). `bubbles` stamps each
 * sender's Speech bubble onto its entity, own Avatar included — one uniform rule (#59). Body
 * emotes need no stamping: they ride the replicated action-state / predicted Avatar, resolved
 * by the renderer (ADR 0020 §9).
 */
export function snapshotToGame(
	field: Zone,
	predicted: Entity,
	ownSessionId: number,
	snapshot: Snapshot | null,
	localSkillCooldowns: Record<string, number>,
	bubbles: ReadonlyMap<number, Bubble> = new Map(),
): GameState {
	const monsters = snapshot ? snapshot.monsters.map(monsterEntity) : [];
	const projectiles = snapshot ? snapshot.projectiles : [];
	// Own in-world Drops (#238): loot is instanced, so the server streamed us only our own —
	// render them straight into the Zone.
	const drops = snapshot ? snapshot.drops : [];
	const others = snapshot
		? snapshot.avatars
				.filter((a) => a.sessionId !== ownSessionId)
				.map((a) => {
					const e = avatarEntity(a);
					const bubble = bubbles.get(a.sessionId)?.text;
					if (bubble) e.bubble = bubble;
					return e;
				})
		: [];
	const ownBubble = bubbles.get(ownSessionId)?.text;
	// Own cosmetics come from the snapshot too, so the local Avatar renders the same look every
	// other client sees — one uniform source (#35).
	const ownSnap = snapshot?.avatars.find((a) => a.sessionId === ownSessionId);
	const ownCosmetics = ownSnap?.cosmetics;
	let avatar = predicted;
	if (ownCosmetics) avatar = { ...avatar, cosmetics: ownCosmetics };
	// Own weapon comes from the snapshot too — same uniform source (ADR 0017 §14).
	if (ownSnap) avatar = { ...avatar, weapon: ownSnap.weapon };
	if (ownBubble) avatar = { ...avatar, bubble: ownBubble };
	const progress = snapshot?.progress ?? { level: 1, xp: 0, gold: 0 };
	const inventory: Item[] = snapshot?.inventory ?? [];
	const log = snapshot?.log ?? ['Connecting…'];

	const zone: Zone = { ...field, monsters, projectiles, drops };
	const player: PlayerState = {
		avatar,
		progress,
		inventory,
		zoneId: field.id,
		log,
		nextId: 0, // loot ids are assigned server-side
		rngState: 0,
		class: 'warrior',
		skillCooldowns: localSkillCooldowns,
	};
	return {
		player,
		world: { zones: { [field.id]: zone }, tick: snapshot?.tick ?? 0 },
		others,
		// Effects ride the snapshot, already originator-suppressed server-side (ADR 0013): the
		// client's own outgoing-hit blood is predicted separately (see index.ts) and suppressed
		// here, so it never double-renders.
		effects: snapshot?.effects ?? [],
	};
}
