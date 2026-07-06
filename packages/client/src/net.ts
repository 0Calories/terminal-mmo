// Networked client transport (ADR 0006). Opens the binary WebSocket, completes
// the hello/welcome handshake, reports the client-owned Avatar position + combat
// intents each tick, and exposes the latest authoritative snapshot. The own
// Avatar is predicted locally (clientStepAvatar) for zero input lag; everything
// else — Monsters, Projectiles, own HP / progress / inventory — is rendered from
// the server's snapshot.
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

// A transient over-head Speech bubble (#59, ADR 0007): the latest Chat line from
// one sender plus its remaining lifetime, decayed each frame.
export interface Bubble {
	text: string;
	ttl: number; // seconds remaining
}

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

// Cap the retained chat history; the HUD only shows the last few lines anyway.
const MAX_CHAT_LOG = 100;

export class NetClient {
	private ws: WebSocket;
	// Recent snapshots, kept so co-present entities can be rendered ~100 ms in the
	// past, interpolated between ticks (ADR 0006 cadence).
	private buffer = new SnapshotBuffer();
	sessionId = 0;
	zoneId = '';
	tickRate = 20;
	ready = false; // welcome received
	// The durable Handle this connection authenticated as (#235) — the registered
	// Handle for a returning key, which may differ from what we asked for.
	// Initialized to the requested handle so a pre-#235 server (whose welcome
	// carries none) leaves it meaningful.
	handle: string;
	latest: Snapshot | null = null;
	// Zone-local chat lines received from the server (#34), each "handle: text",
	// bounded so an idle session can't accumulate them forever.
	chatLog: string[] = [];
	// Active over-head Speech bubbles, keyed by sender sessionId (#59, ADR 0007).
	// One per sender: a new line replaces the prior text and resets the timer; the
	// frame callback decays them and the playfield draws each over its sender's sprite.
	bubbles = new Map<number, Bubble>();
	// Set when the server refuses the connection: a Version mismatch (ADR 0012) or a
	// connection cap (ADR 0009). The caller surfaces this and exits.
	rejected: string | null = null;

	constructor(
		url: string,
		handle: string,
		// The SSH identity that answers the server's auth challenge (ADR 0004,
		// #235): its public key rides `hello`, and `signChallenge` produces the
		// `proof` when the `challenge` arrives.
		private identity: Pick<SshIdentity, 'publicKey' | 'signChallenge'>,
		private onReject: (reason: string) => void = () => {},
		cosmetics: Cosmetics = DEFAULT_COSMETICS,
		weapon = 0,
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
					// The chosen Weapon rides the connect handshake (ADR 0017 §14), so every
					// client sees it the moment this Avatar spawns in.
					weapon,
					publicKey: this.identity.publicKey,
				}),
			);
		};
		this.ws.onmessage = (ev) => {
			const msg = decodeServerMessage(new Uint8Array(ev.data as ArrayBuffer));
			this.ingest(msg, performance.now());
		};
		// Connection failures just mean no fresh snapshots; swallow them so an
		// unhandled error event can't tear the process down.
		this.ws.onerror = () => {};
	}

	// Apply a decoded server message: handshake fields from `welcome`; buffer every
	// `snapshot` (also keeping `latest`, which the own Avatar reconciles its vitals
	// against). `recvTimeMs` is the local clock at receipt, passed in by the caller
	// so the buffer never reads a clock itself and stays deterministically testable.
	ingest(msg: ServerMessage, recvTimeMs: number) {
		// The auth challenge (ADR 0004, #235): sign the nonce and answer with the
		// proof. Signing is async (ssh-agent round-trip), so the proof is sent from
		// the promise — pre-welcome, hence directly on the socket, not via send().
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
			// '' only from a pre-#235 server; the requested handle stays then.
			if (msg.handle) {
				this.handle = msg.handle;
				// Surface the durable identity — a returning key may resolve to a
				// different Handle than the one this launch asked for (#235).
				this.notice(`signed in as ${msg.handle}`);
			}
			this.ready = true;
			return;
		}
		if (msg.t === 'reject') {
			this.rejected = msg.reason;
			this.onReject(msg.reason);
			return;
		}
		if (msg.t === 'chat') {
			this.pushChat(`${msg.handle}: ${msg.text}`);
			// Open / replace the sender's over-head bubble (#59).
			this.bubbles.set(msg.sessionId, {
				text: msg.text,
				ttl: bubbleTtl(msg.text.length),
			});
			return;
		}
		// A private whisper (#40), styled distinctly from Zone chat and rendered by
		// direction: our own echo reads "you → them", an inbound one "them → you".
		// Whispers are private, so they open NO over-head bubble.
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
		// snapshot: on a Zone change, drop the prior Zone's frames — interpolating
		// across the boundary would ease an Avatar between two unrelated coord spaces.
		if (msg.zoneId !== this.zoneId) {
			this.zoneId = msg.zoneId;
			this.buffer = new SnapshotBuffer();
		}
		this.latest = msg;
		this.buffer.push(msg, recvTimeMs);
	}

	// The Zone view to render at local time `nowMs`: co-present entities are eased
	// INTERP_DELAY_MS in the past for smooth motion between 20 Hz ticks. Null until
	// the first snapshot. The own Avatar is replaced downstream by local prediction.
	sample(nowMs: number): Snapshot | null {
		return this.buffer.sample(nowMs - INTERP_DELAY_MS);
	}

	// Append a line to the bounded chat log (shared by say / whisper / notice).
	private pushChat(line: string) {
		this.chatLog.push(line);
		if (this.chatLog.length > MAX_CHAT_LOG)
			this.chatLog.splice(0, this.chatLog.length - MAX_CHAT_LOG);
	}

	// Surface a local system line in the chat log (e.g. a bad `/w` usage), styled
	// like a server notice (#40) — no round-trip.
	notice(text: string) {
		this.pushChat(`* ${text}`);
	}

	// Age every Speech bubble by `dtSec` and drop the expired ones (#59). Called
	// from the frame callback so timing follows real elapsed time, not tick count.
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

	// This session's own Avatar within the latest snapshot, if present.
	ownAvatar() {
		return this.latest?.avatars.find((a) => a.sessionId === this.sessionId);
	}
}

// A co-present Avatar reshaped as a renderable Entity. `speed` is unused by the
// renderer (physics is server-side); `attackT` stays 0 (the swing timer is the
// server's), and the replicated `action` carries the swing so the renderer can draw
// this Avatar's pose + slash-arc — others' attacks are now visible (ADR 0017 §10).
function avatarEntity(a: AvatarSnapshot): Entity {
	return {
		id: a.sessionId,
		type: 'player',
		name: a.handle,
		cosmetics: a.cosmetics,
		// The replicated Weapon index: the renderer composites this Avatar's weapon
		// sprite at the grip — this is what makes another Player's weapon visible.
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
 * Reassemble a `GameState` the existing playfield/HUD can render: the static
 * Field (terrain/portals) with the snapshot's authoritative Monsters and
 * Projectiles, plus the locally-predicted own Avatar carrying server-owned
 * vitals. Co-present Avatars (everyone but `ownSessionId`) ride along in
 * `others` for the playfield to draw. `localSkillCooldowns` are client-predicted
 * (not on the wire). `bubbles` stamps each sender's active Speech bubble onto its
 * entity — own Avatar included, one uniform rule (#59, ADR 0007). Body emotes need
 * no stamping: they ride the replicated action-state (co-present) / the predicted
 * Avatar (own), resolved by the renderer (ADR 0020 §9).
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
	// This session's own in-world Drops (#238): loot is instanced, so the server already
	// streamed us only our own — render them straight into the Zone.
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
	// Own cosmetics come from the snapshot too, so the local Avatar renders the same
	// hue / hat / nameplate every other client sees — one uniform source (#35).
	const ownSnap = snapshot?.avatars.find((a) => a.sessionId === ownSessionId);
	const ownCosmetics = ownSnap?.cosmetics;
	let avatar = predicted;
	if (ownCosmetics) avatar = { ...avatar, cosmetics: ownCosmetics };
	// Own weapon comes from the snapshot too, so the local Avatar composites the same
	// weapon every other client sees — one uniform source (ADR 0017 §14).
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
		// Effects ride the snapshot, already originator-suppressed server-side (ADR
		// 0013): the playfield consumes them once per tick (keyed by world.tick) and
		// spawns particles. The acting client's own outgoing-hit blood is predicted
		// separately (see index.ts) — those Effects are suppressed here, so no double-render.
		effects: snapshot?.effects ?? [],
	};
}
