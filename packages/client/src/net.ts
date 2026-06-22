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
	EMOTE_TTL,
	type Entity,
	emoteById,
	encodeClientMessage,
	type GameState,
	type Item,
	type MonsterSnapshot,
	type PlayerState,
	PROTOCOL_VERSION,
	type ServerMessage,
	type Zone,
} from '@mmo/shared';
import { bubbleTtl } from './bubble';
import { INTERP_DELAY_MS, SnapshotBuffer } from './interp';

// A transient over-head Speech bubble (#59, ADR 0007): the latest Chat line from
// one sender plus its remaining lifetime, decayed each frame.
export interface Bubble {
	text: string;
	ttl: number; // seconds remaining
}

// A transient over-head emote (#38): the id of one sender's active emote plus its
// remaining lifetime, decayed each frame. The renderer resolves the id to its
// multi-row art and draws it on the telegraph layer, like a Speech bubble.
export interface Emote {
	id: string;
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
	latest: Snapshot | null = null;
	// Zone-local chat lines received from the server (#34), each "handle: text",
	// bounded so an idle session can't accumulate them forever.
	chatLog: string[] = [];
	// Active over-head Speech bubbles, keyed by sender sessionId (#59, ADR 0007).
	// One per sender: a new line replaces the prior text and resets the timer; the
	// frame callback decays them and the playfield draws each over its sender's sprite.
	bubbles = new Map<number, Bubble>();
	// Active over-head emotes, keyed by sender sessionId (#38). One per sender: a new
	// emote replaces the prior glyph and resets the timer; the frame callback decays
	// them and the playfield draws each over its sender's sprite (telegraph layer).
	emotes = new Map<number, Emote>();
	// Set when the server refuses the connection (ADR 0009): a protocol-version
	// mismatch or a connection cap. The caller surfaces this and exits.
	rejected: string | null = null;

	constructor(
		url: string,
		handle: string,
		private onReject: (reason: string) => void = () => {},
		cosmetics: Cosmetics = DEFAULT_COSMETICS,
	) {
		this.ws = new WebSocket(url);
		this.ws.binaryType = 'arraybuffer';
		this.ws.onopen = () => {
			this.ws.send(
				encodeClientMessage({
					t: 'hello',
					handle,
					protocol: PROTOCOL_VERSION,
					cosmetics,
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
		if (msg.t === 'welcome') {
			this.sessionId = msg.sessionId;
			this.zoneId = msg.zoneId;
			this.tickRate = msg.tickRate;
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
		// A Zone-local emote (#38): open / replace the sender's transient over-head
		// emote (the renderer resolves the id to its art). An unknown id is dropped
		// (no entry). Emotes are purely visual — no chat-log line, no Speech bubble.
		if (msg.t === 'emote') {
			if (emoteById(msg.emote))
				this.emotes.set(msg.sessionId, { id: msg.emote, ttl: EMOTE_TTL });
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

	// Age every over-head emote by `dtSec` and drop the expired ones (#38). Called
	// from the frame callback so timing follows real elapsed time, not tick count.
	decayEmotes(dtSec: number) {
		for (const [id, e] of this.emotes) {
			e.ttl -= dtSec;
			if (e.ttl <= 0) this.emotes.delete(id);
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
// renderer (physics is server-side); `attackT` is 0 since others' swings aren't
// telegraphed over the wire — we only draw their pose, position, and hurt flash.
function avatarEntity(a: AvatarSnapshot): Entity {
	return {
		id: a.sessionId,
		type: 'player',
		name: a.handle,
		cosmetics: a.cosmetics,
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
	};
}

/**
 * Reassemble a `GameState` the existing playfield/HUD can render: the static
 * Field (terrain/portals) with the snapshot's authoritative Monsters and
 * Projectiles, plus the locally-predicted own Avatar carrying server-owned
 * vitals. Co-present Avatars (everyone but `ownSessionId`) ride along in
 * `others` for the playfield to draw. `localSkillCooldowns` are client-predicted
 * (not on the wire). `bubbles` stamps each sender's active Speech bubble onto its
 * entity — own Avatar included, one uniform rule (#59, ADR 0007); `emotes` does
 * the same for transient over-head emotes (#38).
 */
export function snapshotToGame(
	field: Zone,
	predicted: Entity,
	ownSessionId: number,
	snapshot: Snapshot | null,
	localSkillCooldowns: Record<string, number>,
	bubbles: ReadonlyMap<number, Bubble> = new Map(),
	emotes: ReadonlyMap<number, Emote> = new Map(),
): GameState {
	const monsters = snapshot ? snapshot.monsters.map(monsterEntity) : [];
	const projectiles = snapshot ? snapshot.projectiles : [];
	const others = snapshot
		? snapshot.avatars
				.filter((a) => a.sessionId !== ownSessionId)
				.map((a) => {
					const e = avatarEntity(a);
					const bubble = bubbles.get(a.sessionId)?.text;
					if (bubble) e.bubble = bubble;
					const emote = emotes.get(a.sessionId)?.id;
					if (emote) e.emote = emote;
					return e;
				})
		: [];
	const ownBubble = bubbles.get(ownSessionId)?.text;
	const ownEmote = emotes.get(ownSessionId)?.id;
	// Own cosmetics come from the snapshot too, so the local Avatar renders the same
	// hue / hat / nameplate every other client sees — one uniform source (#35).
	const ownCosmetics = snapshot?.avatars.find(
		(a) => a.sessionId === ownSessionId,
	)?.cosmetics;
	let avatar = predicted;
	if (ownCosmetics) avatar = { ...avatar, cosmetics: ownCosmetics };
	if (ownBubble) avatar = { ...avatar, bubble: ownBubble };
	if (ownEmote) avatar = { ...avatar, emote: ownEmote };
	const progress = snapshot?.progress ?? { level: 1, xp: 0, gold: 0 };
	const inventory: Item[] = snapshot?.inventory ?? [];
	const log = snapshot?.log ?? ['Connecting…'];

	const zone: Zone = { ...field, monsters, projectiles };
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
	};
}
