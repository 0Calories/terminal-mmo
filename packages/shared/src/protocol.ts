// Binary wire protocol for the client/server split (ADR 0006). Hand-rolled over
// a DataView so client and server share one encoder/decoder and the seam is
// round-trip testable. Floats use f64 so encode -> decode is exact (bandwidth is
// trivial at this scale; quant/delta-encoding is a later concern).

import type {
	EntityType,
	Facing,
	Item,
	ItemAffix,
	PlayerProgress,
	Projectile,
	Rarity,
	Slot,
} from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class Writer {
	private buf = new Uint8Array(64);
	private view = new DataView(this.buf.buffer);
	private pos = 0;

	private ensure(n: number) {
		if (this.pos + n <= this.buf.length) return;
		let len = this.buf.length;
		while (len < this.pos + n) len *= 2;
		const next = new Uint8Array(len);
		next.set(this.buf);
		this.buf = next;
		this.view = new DataView(this.buf.buffer);
	}

	u8(v: number) {
		this.ensure(1);
		this.view.setUint8(this.pos, v);
		this.pos += 1;
	}
	i8(v: number) {
		this.ensure(1);
		this.view.setInt8(this.pos, v);
		this.pos += 1;
	}
	u16(v: number) {
		this.ensure(2);
		this.view.setUint16(this.pos, v);
		this.pos += 2;
	}
	u32(v: number) {
		this.ensure(4);
		this.view.setUint32(this.pos, v);
		this.pos += 4;
	}
	i32(v: number) {
		this.ensure(4);
		this.view.setInt32(this.pos, v);
		this.pos += 4;
	}
	f64(v: number) {
		this.ensure(8);
		this.view.setFloat64(this.pos, v);
		this.pos += 8;
	}
	bool(v: boolean) {
		this.u8(v ? 1 : 0);
	}
	str(s: string) {
		const bytes = textEncoder.encode(s);
		this.u32(bytes.length);
		this.ensure(bytes.length);
		this.buf.set(bytes, this.pos);
		this.pos += bytes.length;
	}

	finish(): Uint8Array {
		return this.buf.subarray(0, this.pos);
	}
}

class Reader {
	private view: DataView;
	private pos = 0;

	constructor(private buf: Uint8Array) {
		this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	}

	u8(): number {
		const v = this.view.getUint8(this.pos);
		this.pos += 1;
		return v;
	}
	i8(): number {
		const v = this.view.getInt8(this.pos);
		this.pos += 1;
		return v;
	}
	u16(): number {
		const v = this.view.getUint16(this.pos);
		this.pos += 2;
		return v;
	}
	u32(): number {
		const v = this.view.getUint32(this.pos);
		this.pos += 4;
		return v;
	}
	i32(): number {
		const v = this.view.getInt32(this.pos);
		this.pos += 4;
		return v;
	}
	f64(): number {
		const v = this.view.getFloat64(this.pos);
		this.pos += 8;
		return v;
	}
	bool(): boolean {
		return this.u8() !== 0;
	}
	str(): string {
		const len = this.u32();
		const bytes = this.buf.subarray(this.pos, this.pos + len);
		this.pos += len;
		return textDecoder.decode(bytes);
	}
}

// --- Client -> server -------------------------------------------------------

// `hello` joins with an ephemeral handle; `input` reports the client-owned
// Avatar kinematics (ADR 0001: position is client-authoritative) plus the combat
// intents for the tick. A `skill` of 0 means none was pressed.
export type ClientMessage =
	| { t: 'hello'; handle: string }
	| {
			t: 'input';
			x: number;
			y: number;
			vx: number;
			vy: number;
			facing: Facing;
			onGround: boolean;
			attack: boolean;
			interact: boolean;
			skill?: number;
	  }
	// A Zone-local chat line; the server attributes it to the sender's handle and
	// relays it to the sender's Channel (#34).
	| { t: 'chat'; text: string };

const CLIENT_TAG = { hello: 1, input: 2, chat: 3 } as const;

export function encodeClientMessage(msg: ClientMessage): Uint8Array {
	const w = new Writer();
	switch (msg.t) {
		case 'hello':
			w.u8(CLIENT_TAG.hello);
			w.str(msg.handle);
			break;
		case 'input':
			w.u8(CLIENT_TAG.input);
			w.f64(msg.x);
			w.f64(msg.y);
			w.f64(msg.vx);
			w.f64(msg.vy);
			w.i8(msg.facing);
			w.bool(msg.onGround);
			w.bool(msg.attack);
			w.bool(msg.interact);
			w.u8(msg.skill ?? 0);
			break;
		case 'chat':
			w.u8(CLIENT_TAG.chat);
			w.str(msg.text);
			break;
	}
	return w.finish();
}

export function decodeClientMessage(buf: Uint8Array): ClientMessage {
	const r = new Reader(buf);
	const tag = r.u8();
	switch (tag) {
		case CLIENT_TAG.hello:
			return { t: 'hello', handle: r.str() };
		case CLIENT_TAG.input: {
			const x = r.f64();
			const y = r.f64();
			const vx = r.f64();
			const vy = r.f64();
			const facing = r.i8() as Facing;
			const onGround = r.bool();
			const attack = r.bool();
			const interact = r.bool();
			const skill = r.u8();
			const msg: ClientMessage = {
				t: 'input',
				x,
				y,
				vx,
				vy,
				facing,
				onGround,
				attack,
				interact,
			};
			if (skill !== 0) msg.skill = skill;
			return msg;
		}
		case CLIENT_TAG.chat:
			return { t: 'chat', text: r.str() };
		default:
			throw new Error(`unknown client message tag ${tag}`);
	}
}

// --- Server -> client -------------------------------------------------------

// The server-owned view of one Avatar streamed to clients: kinematics for
// rendering others + server-authoritative vitals (ADR 0001). The recipient finds
// itself by `sessionId` to reconcile its own HP/respawn.
export interface AvatarSnapshot {
	sessionId: number;
	handle: string; // ephemeral nameplate handle from the handshake
	x: number;
	y: number;
	vx: number;
	vy: number;
	facing: Facing;
	onGround: boolean;
	hp: number;
	maxHp: number;
	hurtT: number;
}

export interface MonsterSnapshot {
	id: number;
	type: EntityType;
	x: number;
	y: number;
	vx: number;
	vy: number;
	facing: Facing;
	onGround: boolean;
	hp: number;
	maxHp: number;
	hurtT: number;
}

// `welcome` answers the handshake; `snapshot` is the authoritative Zone state for
// one tick plus this Player's private progress/inventory/log (respawn shows up as
// a position reset + a log line, so it needs no dedicated field).
export type ServerMessage =
	| { t: 'welcome'; sessionId: number; zoneId: string; tickRate: number }
	| {
			t: 'snapshot';
			tick: number;
			zoneId: string;
			avatars: AvatarSnapshot[];
			monsters: MonsterSnapshot[];
			projectiles: Projectile[];
			progress: PlayerProgress;
			inventory: Item[];
			log: string[];
	  }
	// A Zone-local chat line relayed to every session in the sender's Channel,
	// attributed to the sender's ephemeral handle (#34). Event-driven, not per-tick.
	| { t: 'chat'; handle: string; text: string };

const SERVER_TAG = { welcome: 1, snapshot: 2, chat: 3 } as const;

const ENTITY_TYPES: readonly EntityType[] = ['player', 'chaser', 'shooter'];
const SLOTS: readonly Slot[] = ['weapon', 'armor', 'accessory'];
const RARITIES: readonly Rarity[] = [
	'common',
	'uncommon',
	'rare',
	'epic',
	'legendary',
];

function writeAvatar(w: Writer, a: AvatarSnapshot) {
	w.u32(a.sessionId);
	w.str(a.handle);
	w.f64(a.x);
	w.f64(a.y);
	w.f64(a.vx);
	w.f64(a.vy);
	w.i8(a.facing);
	w.bool(a.onGround);
	w.f64(a.hp);
	w.f64(a.maxHp);
	w.f64(a.hurtT);
}

function readAvatar(r: Reader): AvatarSnapshot {
	return {
		sessionId: r.u32(),
		handle: r.str(),
		x: r.f64(),
		y: r.f64(),
		vx: r.f64(),
		vy: r.f64(),
		facing: r.i8() as Facing,
		onGround: r.bool(),
		hp: r.f64(),
		maxHp: r.f64(),
		hurtT: r.f64(),
	};
}

function writeMonster(w: Writer, m: MonsterSnapshot) {
	w.u32(m.id);
	w.u8(ENTITY_TYPES.indexOf(m.type));
	w.f64(m.x);
	w.f64(m.y);
	w.f64(m.vx);
	w.f64(m.vy);
	w.i8(m.facing);
	w.bool(m.onGround);
	w.f64(m.hp);
	w.f64(m.maxHp);
	w.f64(m.hurtT);
}

function readMonster(r: Reader): MonsterSnapshot {
	return {
		id: r.u32(),
		type: ENTITY_TYPES[r.u8()],
		x: r.f64(),
		y: r.f64(),
		vx: r.f64(),
		vy: r.f64(),
		facing: r.i8() as Facing,
		onGround: r.bool(),
		hp: r.f64(),
		maxHp: r.f64(),
		hurtT: r.f64(),
	};
}

function writeProjectile(w: Writer, p: Projectile) {
	w.u32(p.id);
	w.f64(p.x);
	w.f64(p.y);
	w.f64(p.vx);
	w.f64(p.vy);
	w.f64(p.life);
	w.f64(p.damage);
	w.u32(p.ownerId);
}

function readProjectile(r: Reader): Projectile {
	return {
		id: r.u32(),
		x: r.f64(),
		y: r.f64(),
		vx: r.f64(),
		vy: r.f64(),
		life: r.f64(),
		damage: r.f64(),
		ownerId: r.u32(),
	};
}

function writeItem(w: Writer, it: Item) {
	w.u32(it.id);
	w.str(it.base);
	w.u8(SLOTS.indexOf(it.slot));
	w.u8(RARITIES.indexOf(it.rarity));
	w.u32(it.affixes.length);
	for (const a of it.affixes) {
		w.str(a.stat);
		w.i32(a.value);
	}
}

function readItem(r: Reader): Item {
	const id = r.u32();
	const base = r.str();
	const slot = SLOTS[r.u8()];
	const rarity = RARITIES[r.u8()];
	const n = r.u32();
	const affixes: ItemAffix[] = [];
	for (let i = 0; i < n; i++) affixes.push({ stat: r.str(), value: r.i32() });
	return { id, base, slot, rarity, affixes };
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array {
	const w = new Writer();
	switch (msg.t) {
		case 'welcome':
			w.u8(SERVER_TAG.welcome);
			w.u32(msg.sessionId);
			w.str(msg.zoneId);
			w.u16(msg.tickRate);
			break;
		case 'snapshot':
			w.u8(SERVER_TAG.snapshot);
			w.u32(msg.tick);
			w.str(msg.zoneId);
			w.u32(msg.avatars.length);
			for (const a of msg.avatars) writeAvatar(w, a);
			w.u32(msg.monsters.length);
			for (const m of msg.monsters) writeMonster(w, m);
			w.u32(msg.projectiles.length);
			for (const p of msg.projectiles) writeProjectile(w, p);
			w.u32(msg.progress.level);
			w.u32(msg.progress.xp);
			w.u32(msg.progress.gold);
			w.u32(msg.inventory.length);
			for (const it of msg.inventory) writeItem(w, it);
			w.u32(msg.log.length);
			for (const line of msg.log) w.str(line);
			break;
		case 'chat':
			w.u8(SERVER_TAG.chat);
			w.str(msg.handle);
			w.str(msg.text);
			break;
	}
	return w.finish();
}

export function decodeServerMessage(buf: Uint8Array): ServerMessage {
	const r = new Reader(buf);
	const tag = r.u8();
	switch (tag) {
		case SERVER_TAG.welcome:
			return {
				t: 'welcome',
				sessionId: r.u32(),
				zoneId: r.str(),
				tickRate: r.u16(),
			};
		case SERVER_TAG.snapshot: {
			const tick = r.u32();
			const zoneId = r.str();
			const avatars: AvatarSnapshot[] = [];
			for (let i = r.u32(); i > 0; i--) avatars.push(readAvatar(r));
			const monsters: MonsterSnapshot[] = [];
			for (let i = r.u32(); i > 0; i--) monsters.push(readMonster(r));
			const projectiles: Projectile[] = [];
			for (let i = r.u32(); i > 0; i--) projectiles.push(readProjectile(r));
			const progress: PlayerProgress = {
				level: r.u32(),
				xp: r.u32(),
				gold: r.u32(),
			};
			const inventory: Item[] = [];
			for (let i = r.u32(); i > 0; i--) inventory.push(readItem(r));
			const log: string[] = [];
			for (let i = r.u32(); i > 0; i--) log.push(r.str());
			return {
				t: 'snapshot',
				tick,
				zoneId,
				avatars,
				monsters,
				projectiles,
				progress,
				inventory,
				log,
			};
		}
		case SERVER_TAG.chat:
			return { t: 'chat', handle: r.str(), text: r.str() };
		default:
			throw new Error(`unknown server message tag ${tag}`);
	}
}
