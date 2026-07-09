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
} from '@mmo/core';
import type { SshIdentity } from '../ssh-auth';
import { bubbleTtl } from '../ui/bubble';
import { CLIENT_VERSION } from '../version';
import { INTERP_DELAY_MS, SnapshotBuffer } from './interp';

export interface Bubble {
	text: string;
	ttl: number;
}

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

const MAX_CHAT_LOG = 100;

export class NetClient {
	private ws: WebSocket;
	private buffer = new SnapshotBuffer();
	sessionId = 0;
	zoneId = '';
	tickRate = 20;
	ready = false;
	handle: string;
	latest: Snapshot | null = null;
	chatLog: string[] = [];
	bubbles = new Map<number, Bubble>();
	rejected: string | null = null;
	// Unlike onReject, does NOT close the connection — caller keeps the creator open to retry.
	onCreateRejected: (reason: 'taken' | 'invalid') => void = () => {};
	onSpawned: () => void = () => {};
	private spawnNotified = false;
	private isNewAccount = false;

	constructor(
		url: string,
		handle: string,
		private identity: Pick<SshIdentity, 'publicKey' | 'signChallenge'>,
		private onReject: (reason: string) => void = () => {},
		cosmetics: Cosmetics = DEFAULT_COSMETICS,
		weapon = 0,
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
					weapon,
					publicKey: this.identity.publicKey,
				}),
			);
		};
		this.ws.onmessage = (ev) => {
			const msg = decodeServerMessage(new Uint8Array(ev.data as ArrayBuffer));
			this.ingest(msg, performance.now());
		};
		// Swallow errors — an unhandled ws error event would tear the process down.
		this.ws.onerror = () => {};
	}

	ingest(msg: ServerMessage, recvTimeMs: number) {
		// Sent directly, not via send(): signing is async and this is pre-welcome, before the ready-gate opens.
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
			if (msg.handle) {
				this.handle = msg.handle;
				// New account claims its Handle only at createAvatar (after welcome), so defer to spawn.
				if (!msg.isNew) this.signedInAs(msg.handle);
			}
			this.ready = true;
			// After ready flips, so a createAvatar sent from the callback passes the send() gate.
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
			this.bubbles.set(msg.sessionId, {
				text: msg.text,
				ttl: bubbleTtl(msg.text.length),
			});
			return;
		}
		if (msg.t === 'whisper') {
			const line =
				msg.fromSessionId === this.sessionId
					? `[you → ${msg.to}] ${msg.text}`
					: `[${msg.from} → you] ${msg.text}`;
			this.pushChat(line);
			return;
		}
		if (msg.t === 'notice') {
			this.notice(msg.text);
			return;
		}
		if (msg.t === 'createRejected') {
			this.onCreateRejected(msg.reason);
			return;
		}
		// Zone change: drop prior frames so interp never eases across two unrelated coord spaces.
		if (msg.zoneId !== this.zoneId) {
			this.zoneId = msg.zoneId;
			this.buffer = new SnapshotBuffer();
		}
		this.latest = msg;
		this.buffer.push(msg, recvTimeMs);
		if (!this.spawnNotified) {
			this.spawnNotified = true;
			// New account: read the claimed name off the own Avatar snapshot (claimed only at createAvatar).
			if (this.isNewAccount) {
				const claimed = this.ownAvatar()?.handle;
				if (claimed) this.signedInAs(claimed);
			}
			this.onSpawned();
		}
	}

	sample(nowMs: number): Snapshot | null {
		return this.buffer.sample(nowMs - INTERP_DELAY_MS);
	}

	private pushChat(line: string) {
		this.chatLog.push(line);
		if (this.chatLog.length > MAX_CHAT_LOG)
			this.chatLog.splice(0, this.chatLog.length - MAX_CHAT_LOG);
	}

	notice(text: string) {
		this.pushChat(`* ${text}`);
	}

	private signedInAs(name: string) {
		this.notice(`signed in as ${name}`);
	}

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

function avatarEntity(a: AvatarSnapshot): Entity {
	return {
		id: a.sessionId,
		type: 'player',
		name: a.handle,
		cosmetics: a.cosmetics,
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
		speed: 0,
		facing: m.facing,
		onGround: m.onGround,
		hp: m.hp,
		maxHp: m.maxHp,
		hurtT: m.hurtT,
		attackT: 0,
		action: m.action,
	};
}

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
	const ownSnap = snapshot?.avatars.find((a) => a.sessionId === ownSessionId);
	const ownCosmetics = ownSnap?.cosmetics;
	let avatar = predicted;
	if (ownCosmetics) avatar = { ...avatar, cosmetics: ownCosmetics };
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
		nextId: 0,
		rngState: 0,
		class: 'warrior',
		skillCooldowns: localSkillCooldowns,
	};
	return {
		player,
		world: { zones: { [field.id]: zone }, tick: snapshot?.tick ?? 0 },
		others,
		events: snapshot?.events ?? [],
	};
}
