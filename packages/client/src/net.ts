// Networked client transport (ADR 0006). Opens the binary WebSocket, completes
// the hello/welcome handshake, reports the client-owned Avatar position + combat
// intents each tick, and exposes the latest authoritative snapshot. The own
// Avatar is predicted locally (clientStepAvatar) for zero input lag; everything
// else — Monsters, Projectiles, own HP / progress / inventory — is rendered from
// the server's snapshot.
import {
	type AvatarSnapshot,
	type ClientMessage,
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
import { INTERP_DELAY_MS, SnapshotBuffer } from './interp';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

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

	constructor(url: string, handle: string) {
		this.ws = new WebSocket(url);
		this.ws.binaryType = 'arraybuffer';
		this.ws.onopen = () => {
			this.ws.send(encodeClientMessage({ t: 'hello', handle }));
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
		} else {
			this.latest = msg;
			this.buffer.push(msg, recvTimeMs);
		}
	}

	// The Zone view to render at local time `nowMs`: co-present entities are eased
	// INTERP_DELAY_MS in the past for smooth motion between 20 Hz ticks. Null until
	// the first snapshot. The own Avatar is replaced downstream by local prediction.
	sample(nowMs: number): Snapshot | null {
		return this.buffer.sample(nowMs - INTERP_DELAY_MS);
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
 * (not on the wire).
 */
export function snapshotToGame(
	field: Zone,
	predicted: Entity,
	ownSessionId: number,
	snapshot: Snapshot | null,
	localSkillCooldowns: Record<string, number>,
): GameState {
	const monsters = snapshot ? snapshot.monsters.map(monsterEntity) : [];
	const projectiles = snapshot ? snapshot.projectiles : [];
	const others = snapshot
		? snapshot.avatars
				.filter((a) => a.sessionId !== ownSessionId)
				.map(avatarEntity)
		: [];
	const progress = snapshot?.progress ?? { level: 1, xp: 0, gold: 0 };
	const inventory: Item[] = snapshot?.inventory ?? [];
	const log = snapshot?.log ?? ['Connecting…'];

	const zone: Zone = { ...field, monsters, projectiles };
	const player: PlayerState = {
		avatar: predicted,
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
