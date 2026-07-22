import {
	type Cosmetics,
	DEFAULT_COSMETICS,
	type Entity,
	type Item,
} from '@mmo/core/entities';
import {
	type AvatarSnapshot,
	type ClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	type GameState,
	type MonsterSnapshot,
	type PlayerState,
	type ServerMessage,
} from '@mmo/core/protocol';
import type { Zone } from '@mmo/core/zones';
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

		this.ws.onerror = () => {};
	}

	ingest(msg: ServerMessage, recvTimeMs: number) {
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

				if (!msg.isNew) this.signedInAs(msg.handle);
			}
			this.ready = true;

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

		if (msg.zoneId !== this.zoneId) {
			this.zoneId = msg.zoneId;
			this.buffer = new SnapshotBuffer();
		}
		this.latest = msg;
		this.buffer.push(msg, recvTimeMs);
		if (!this.spawnNotified) {
			this.spawnNotified = true;

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
