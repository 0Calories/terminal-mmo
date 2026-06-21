// Networked client transport (ADR 0006). Opens the binary WebSocket, completes
// the hello/welcome handshake, reports the client-owned Avatar position + combat
// intents each tick, and exposes the latest authoritative snapshot. The own
// Avatar is predicted locally (clientStepAvatar) for zero input lag; everything
// else — Monsters, Projectiles, own HP / progress / inventory — is rendered from
// the server's snapshot.
import {
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

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

export class NetClient {
	private ws: WebSocket;
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
			if (msg.t === 'welcome') {
				this.sessionId = msg.sessionId;
				this.zoneId = msg.zoneId;
				this.tickRate = msg.tickRate;
				this.ready = true;
			} else {
				this.latest = msg;
			}
		};
	}

	send(msg: ClientMessage) {
		if (this.ready && this.ws.readyState === WebSocket.OPEN)
			this.ws.send(encodeClientMessage(msg));
	}

	// This session's own Avatar within the latest snapshot, if present.
	ownAvatar() {
		return this.latest?.avatars.find((a) => a.sessionId === this.sessionId);
	}
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
 * vitals. `localSkillCooldowns` are client-predicted (not on the wire).
 */
export function snapshotToGame(
	field: Zone,
	predicted: Entity,
	snapshot: Snapshot | null,
	localSkillCooldowns: Record<string, number>,
): GameState {
	const monsters = snapshot ? snapshot.monsters.map(monsterEntity) : [];
	const projectiles = snapshot ? snapshot.projectiles : [];
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
	};
}
