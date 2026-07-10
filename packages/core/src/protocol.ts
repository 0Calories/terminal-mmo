import type { CombatEvent, CombatEventKind } from './combat';
import { SHOOTER } from './constants';
import {
	clampCosmetics,
	DEFAULT_COSMETICS,
	DEFAULT_FORM_ID,
	LEGACY_FORM_IDS,
	LEGACY_HAT_IDS,
} from './cosmetics';
import { EMOTES } from './emote';
import type {
	ActionState,
	AttackPhase,
	Cosmetics,
	Drop,
	EntityType,
	Facing,
	Item,
	ItemAffix,
	MoveId,
	PlayerProgress,
	Projectile,
	Rarity,
	Slot,
} from './types';
import { DEFAULT_WEAPON } from './weapons';

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
	bytes(b: Uint8Array) {
		this.u32(b.length);
		this.ensure(b.length);
		this.buf.set(b, this.pos);
		this.pos += b.length;
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
	bytes(): Uint8Array {
		const len = this.u32();
		// slice (not subarray) so the value outlives the socket's recycled receive buffer.
		const out = this.buf.slice(this.pos, this.pos + len);
		this.pos += len;
		return out;
	}
	remaining(): number {
		return this.buf.byteLength - this.pos;
	}
}

export type ClientMessage =
	| {
			t: 'hello';
			handle: string;
			version: string;
			cosmetics: Cosmetics;
			weapon: number;
			publicKey: string;
	  }
	| { t: 'proof'; signature: Uint8Array }
	| {
			t: 'input';
			x: number;
			y: number;
			vx: number;
			vy: number;
			facing: Facing;
			onGround: boolean;
			attack: boolean;
			guard: boolean;
			interact: boolean;
			dodge: boolean;
			skill?: number;
	  }
	| { t: 'chat'; text: string }
	| { t: 'whisper'; to: string; text: string }
	| { t: 'emote'; emote: string }
	| { t: 'sell'; itemId: number }
	| { t: 'buy'; index: number }
	| { t: 'createAvatar'; handle: string; cosmetics: Cosmetics }
	| { t: 'setCosmetics'; cosmetics: Cosmetics };

// Legacy (pre-#348) 4×u8 quad, BYTE-IDENTICAL to what a released client
// sends/expects — the hat and form bytes carry LEGACY_HAT_IDS / LEGACY_FORM_IDS
// indices, best-effort only. The full-fidelity string hat AND form ids ride as
// separate trailing fields on each message (see CONTRIBUTING "Wire protocol
// changes"), appended after this quad (hat first, then form) and read behind a
// `remaining()` guard so they override the quad-derived values when present, and
// legacy frames still decode cleanly without them.
function writeCosmetics(w: Writer, c: Cosmetics) {
	w.u8(c.hue);
	const hatIdx = LEGACY_HAT_IDS.indexOf(c.hat);
	w.u8(hatIdx >= 0 ? hatIdx : 0);
	w.u8(c.nameplate);
	const formIdx = LEGACY_FORM_IDS.indexOf(c.form);
	w.u8(formIdx >= 0 ? formIdx : 0);
}

function readCosmetics(r: Reader): Cosmetics {
	return clampCosmetics({
		hue: r.u8(),
		hat: LEGACY_HAT_IDS[r.u8()] ?? '',
		nameplate: r.u8(),
		form: LEGACY_FORM_IDS[r.u8()] ?? DEFAULT_FORM_ID,
	});
}

// Reads the appended full-fidelity hat id, if present, else falls back to the
// quad-derived hat (a legacy peer's best-effort mapping).
function readTrailingHat(r: Reader, fallback: string): string {
	return r.remaining() >= 4 ? r.str() : fallback;
}

// Reads the appended full-fidelity form id, if present, else falls back to the
// quad-derived form (a legacy peer's best-effort mapping). Sits immediately
// after the trailing hat id, so read it only once the hat field is consumed.
function readTrailingForm(r: Reader, fallback: string): string {
	return r.remaining() >= 4 ? r.str() : fallback;
}

const CLIENT_TAG = {
	hello: 1,
	input: 2,
	chat: 3,
	whisper: 4,
	emote: 5,
	proof: 6,
	sell: 7,
	buy: 8,
	createAvatar: 9,
	setCosmetics: 10,
} as const;

export function encodeClientMessage(msg: ClientMessage): Uint8Array {
	const w = new Writer();
	switch (msg.t) {
		case 'hello':
			w.u8(CLIENT_TAG.hello);
			w.str(msg.handle);
			w.str(msg.version);
			writeCosmetics(w, msg.cosmetics);
			w.u8(msg.weapon);
			w.str(msg.publicKey);
			w.str(msg.cosmetics.hat); // append-only: full-fidelity hat id (CONTRIBUTING §wire)
			w.str(msg.cosmetics.form); // append-only: full-fidelity form id (CONTRIBUTING §wire)
			break;
		case 'proof':
			w.u8(CLIENT_TAG.proof);
			w.bytes(msg.signature);
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
			w.bool(msg.dodge);
			w.bool(msg.guard);
			break;
		case 'chat':
			w.u8(CLIENT_TAG.chat);
			w.str(msg.text);
			break;
		case 'whisper':
			w.u8(CLIENT_TAG.whisper);
			w.str(msg.to);
			w.str(msg.text);
			break;
		case 'emote':
			w.u8(CLIENT_TAG.emote);
			w.str(msg.emote);
			break;
		case 'sell':
			w.u8(CLIENT_TAG.sell);
			w.u32(msg.itemId);
			break;
		case 'buy':
			w.u8(CLIENT_TAG.buy);
			w.u32(msg.index);
			break;
		case 'createAvatar':
			w.u8(CLIENT_TAG.createAvatar);
			writeCosmetics(w, msg.cosmetics);
			w.str(msg.handle);
			w.str(msg.cosmetics.hat); // append-only: full-fidelity hat id (CONTRIBUTING §wire)
			w.str(msg.cosmetics.form); // append-only: full-fidelity form id (CONTRIBUTING §wire)
			break;
		case 'setCosmetics':
			w.u8(CLIENT_TAG.setCosmetics);
			writeCosmetics(w, msg.cosmetics);
			w.str(msg.cosmetics.hat); // append-only: full-fidelity hat id (CONTRIBUTING §wire)
			w.str(msg.cosmetics.form); // append-only: full-fidelity form id (CONTRIBUTING §wire)
			break;
	}
	return w.finish();
}

export function decodeClientMessage(buf: Uint8Array): ClientMessage {
	const r = new Reader(buf);
	const tag = r.u8();
	switch (tag) {
		case CLIENT_TAG.hello: {
			const handle = r.str();
			const version = r.remaining() >= 4 ? r.str() : '';
			// legacy quad: hue(1) + hat(1) + nameplate(1) + form(1) = 4 bytes
			const quad = r.remaining() >= 4 ? readCosmetics(r) : DEFAULT_COSMETICS;
			const weapon = r.remaining() >= 1 ? r.u8() : DEFAULT_WEAPON;
			const publicKey = r.remaining() >= 4 ? r.str() : '';
			const hat = readTrailingHat(r, quad.hat);
			const form = readTrailingForm(r, quad.form);
			return {
				t: 'hello',
				handle,
				version,
				cosmetics:
					hat === quad.hat && form === quad.form
						? quad
						: { ...quad, hat, form },
				weapon,
				publicKey,
			};
		}
		case CLIENT_TAG.proof:
			return { t: 'proof', signature: r.bytes() };
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
			const dodge = r.remaining() >= 1 ? r.bool() : false;
			const guard = r.remaining() >= 1 ? r.bool() : false;
			const msg: ClientMessage = {
				t: 'input',
				x,
				y,
				vx,
				vy,
				facing,
				onGround,
				attack,
				guard,
				interact,
				dodge,
			};
			if (skill !== 0) msg.skill = skill;
			return msg;
		}
		case CLIENT_TAG.chat:
			return { t: 'chat', text: r.str() };
		case CLIENT_TAG.whisper:
			return { t: 'whisper', to: r.str(), text: r.str() };
		case CLIENT_TAG.emote:
			return { t: 'emote', emote: r.str() };
		case CLIENT_TAG.sell:
			return { t: 'sell', itemId: r.u32() };
		case CLIENT_TAG.buy:
			return { t: 'buy', index: r.u32() };
		case CLIENT_TAG.createAvatar: {
			const quad = readCosmetics(r);
			const handle = r.remaining() >= 4 ? r.str() : '';
			const hat = readTrailingHat(r, quad.hat);
			const form = readTrailingForm(r, quad.form);
			return {
				t: 'createAvatar',
				handle,
				cosmetics:
					hat === quad.hat && form === quad.form
						? quad
						: { ...quad, hat, form },
			};
		}
		case CLIENT_TAG.setCosmetics: {
			const quad = readCosmetics(r);
			const hat = readTrailingHat(r, quad.hat);
			const form = readTrailingForm(r, quad.form);
			return {
				t: 'setCosmetics',
				cosmetics:
					hat === quad.hat && form === quad.form
						? quad
						: { ...quad, hat, form },
			};
		}
		default:
			throw new Error(`unknown client message tag ${tag}`);
	}
}

export interface AvatarSnapshot {
	sessionId: number;
	handle: string;
	cosmetics: Cosmetics;
	x: number;
	y: number;
	vx: number;
	vy: number;
	facing: Facing;
	onGround: boolean;
	hp: number;
	maxHp: number;
	hurtT: number;
	weapon: number;
	action: ActionState;
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
	action: ActionState;
}

export type ServerMessage =
	| { t: 'challenge'; nonce: Uint8Array }
	| {
			t: 'welcome';
			sessionId: number;
			zoneId: string;
			tickRate: number;
			handle: string;
			isNew: boolean;
	  }
	| {
			t: 'snapshot';
			tick: number;
			zoneId: string;
			avatars: AvatarSnapshot[];
			monsters: MonsterSnapshot[];
			projectiles: Projectile[];
			events: CombatEvent[];
			drops: Drop[];
			progress: PlayerProgress;
			inventory: Item[];
			log: string[];
	  }
	| { t: 'chat'; sessionId: number; handle: string; text: string }
	| {
			t: 'whisper';
			fromSessionId: number;
			from: string;
			to: string;
			text: string;
	  }
	| { t: 'notice'; text: string }
	| { t: 'reject'; reason: string }
	| { t: 'createRejected'; reason: 'taken' | 'invalid' };

const SERVER_TAG = {
	welcome: 1,
	snapshot: 2,
	chat: 3,
	reject: 4,
	whisper: 5,
	notice: 6,
	challenge: 7,
	createRejected: 8,
} as const;

const CREATE_REJECT_REASONS = ['taken', 'invalid'] as const;

const ENTITY_TYPES: readonly EntityType[] = [
	'player',
	'chaser',
	'shooter',
	'brute',
];
// Append-only: array position is the wire encoding, so reordering silently remaps values.
const COMBAT_EVENT_KINDS: readonly CombatEventKind[] = [
	'hit',
	'break',
	'death',
	'swat',
];
const MOVE_IDS: readonly MoveId[] = ['idle', 'basic', 'dodge'];
const ATTACK_PHASES: readonly AttackPhase[] = ['windup', 'active', 'recovery'];
const EMOTE_IDS: readonly string[] = EMOTES.map((e) => e.id);
const NO_EMOTE = 0xff;

function writeAction(w: Writer, a: ActionState) {
	w.u8(MOVE_IDS.indexOf(a.move));
	w.u8(ATTACK_PHASES.indexOf(a.phase));
	w.f64(a.progress);
	w.u8(a.flags);
	const ei = a.emote ? EMOTE_IDS.indexOf(a.emote) : -1;
	w.u8(ei >= 0 ? ei : NO_EMOTE);
	w.f64(a.emoteT);
}

function readAction(r: Reader): ActionState {
	return {
		move: MOVE_IDS[r.u8()] ?? 'idle',
		phase: ATTACK_PHASES[r.u8()] ?? 'windup',
		progress: r.f64(),
		flags: r.u8(),
		emote: EMOTE_IDS[r.u8()] ?? null,
		emoteT: r.f64(),
	};
}
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
	writeCosmetics(w, a.cosmetics);
	w.f64(a.x);
	w.f64(a.y);
	w.f64(a.vx);
	w.f64(a.vy);
	w.i8(a.facing);
	w.bool(a.onGround);
	w.f64(a.hp);
	w.f64(a.maxHp);
	w.f64(a.hurtT);
	w.u8(a.weapon);
	writeAction(w, a.action);
	// Append-only: full-fidelity hat id at the END of the record. A per-record
	// trailing field shifts subsequent records for a stale reader, but
	// snapshots only ever flow between gate-matched peers (a release client
	// talking to its matching release server) or same-source peers (dev), so
	// record-level append is safe here — the quad still carries a
	// legacy-best-effort hat + form for any peer that doesn't read this far.
	w.str(a.cosmetics.hat);
	w.str(a.cosmetics.form);
}

function readAvatar(r: Reader): AvatarSnapshot {
	const sessionId = r.u32();
	const handle = r.str();
	const quad = readCosmetics(r);
	const x = r.f64();
	const y = r.f64();
	const vx = r.f64();
	const vy = r.f64();
	const facing = r.i8() as Facing;
	const onGround = r.bool();
	const hp = r.f64();
	const maxHp = r.f64();
	const hurtT = r.f64();
	const weapon = r.u8();
	const action = readAction(r);
	const hat = readTrailingHat(r, quad.hat);
	const form = readTrailingForm(r, quad.form);
	return {
		sessionId,
		handle,
		cosmetics:
			hat === quad.hat && form === quad.form ? quad : { ...quad, hat, form },
		x,
		y,
		vx,
		vy,
		facing,
		onGround,
		hp,
		maxHp,
		hurtT,
		weapon,
		action,
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
	writeAction(w, m.action);
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
		action: readAction(r),
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
	w.f64(p.poiseDamage);
	w.f64(p.knockback);
	w.f64(p.knockbackUp);
}

function readProjectile(r: Reader): Projectile {
	const base = {
		id: r.u32(),
		x: r.f64(),
		y: r.f64(),
		vx: r.f64(),
		vy: r.f64(),
		life: r.f64(),
		damage: r.f64(),
	};
	if (r.remaining() < 1)
		return {
			...base,
			poiseDamage: SHOOTER.projPoise,
			knockback: SHOOTER.projKnockback,
			knockbackUp: SHOOTER.projKnockbackUp,
		};
	return {
		...base,
		poiseDamage: r.f64(),
		knockback: r.f64(),
		knockbackUp: r.f64(),
	};
}

function writeCombatEvent(w: Writer, e: CombatEvent) {
	w.u8(COMBAT_EVENT_KINDS.indexOf(e.kind));
	w.u32(e.targetId);
	w.f64(e.x);
	w.f64(e.y);
	w.f64(e.intensity);
	w.i8(e.dir);
	const tint = e.kind === 'death' ? e.tint : undefined;
	w.bool(tint !== undefined);
	if (tint !== undefined) {
		w.u8(tint.r);
		w.u8(tint.g);
		w.u8(tint.b);
	}
}

function readCombatEvent(r: Reader): CombatEvent {
	const kind = COMBAT_EVENT_KINDS[r.u8()] ?? 'hit';
	const targetId = r.u32();
	const x = r.f64();
	const y = r.f64();
	const intensity = r.f64();
	const rawDir = r.i8();
	const hasTint = r.bool();
	const tint = hasTint ? { r: r.u8(), g: r.u8(), b: r.u8() } : undefined;
	switch (kind) {
		case 'hit':
			return { kind, targetId, x, y, intensity, dir: rawDir as -1 | 0 | 1 };
		case 'break':
			return { kind, targetId, x, y, intensity, dir: rawDir as -1 | 0 | 1 };
		case 'swat':
			return { kind, targetId, x, y, intensity, dir: (rawDir || 1) as Facing };
		case 'death':
			return { kind, targetId, x, y, intensity, dir: 0, tint };
	}
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

function writeDrop(w: Writer, d: Drop) {
	w.u32(d.id);
	w.u32(d.owner);
	w.f64(d.x);
	w.f64(d.y);
	w.f64(d.w);
	w.f64(d.h);
	w.f64(d.ttl);
	writeItem(w, d.item);
}

function readDrop(r: Reader): Drop {
	return {
		id: r.u32(),
		owner: r.u32(),
		x: r.f64(),
		y: r.f64(),
		w: r.f64(),
		h: r.f64(),
		ttl: r.f64(),
		item: readItem(r),
	};
}

export function encodeServerMessage(msg: ServerMessage): Uint8Array {
	const w = new Writer();
	switch (msg.t) {
		case 'challenge':
			w.u8(SERVER_TAG.challenge);
			w.bytes(msg.nonce);
			break;
		case 'welcome':
			w.u8(SERVER_TAG.welcome);
			w.u32(msg.sessionId);
			w.str(msg.zoneId);
			w.u16(msg.tickRate);
			w.str(msg.handle);
			w.bool(msg.isNew);
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
			w.u32(msg.events.length);
			for (const e of msg.events) writeCombatEvent(w, e);
			w.u32(msg.drops.length);
			for (const d of msg.drops) writeDrop(w, d);
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
			w.u32(msg.sessionId);
			w.str(msg.handle);
			w.str(msg.text);
			break;
		case 'whisper':
			w.u8(SERVER_TAG.whisper);
			w.u32(msg.fromSessionId);
			w.str(msg.from);
			w.str(msg.to);
			w.str(msg.text);
			break;
		case 'notice':
			w.u8(SERVER_TAG.notice);
			w.str(msg.text);
			break;
		case 'reject':
			w.u8(SERVER_TAG.reject);
			w.str(msg.reason);
			break;
		case 'createRejected':
			w.u8(SERVER_TAG.createRejected);
			w.u8(CREATE_REJECT_REASONS.indexOf(msg.reason));
			break;
	}
	return w.finish();
}

export function decodeServerMessage(buf: Uint8Array): ServerMessage {
	const r = new Reader(buf);
	const tag = r.u8();
	switch (tag) {
		case SERVER_TAG.challenge:
			return { t: 'challenge', nonce: r.bytes() };
		case SERVER_TAG.welcome: {
			const sessionId = r.u32();
			const zoneId = r.str();
			const tickRate = r.u16();
			const handle = r.remaining() >= 4 ? r.str() : '';
			const isNew = r.remaining() >= 1 ? r.bool() : false;
			return { t: 'welcome', sessionId, zoneId, tickRate, handle, isNew };
		}
		case SERVER_TAG.snapshot: {
			const tick = r.u32();
			const zoneId = r.str();
			const avatars: AvatarSnapshot[] = [];
			for (let i = r.u32(); i > 0; i--) avatars.push(readAvatar(r));
			const monsters: MonsterSnapshot[] = [];
			for (let i = r.u32(); i > 0; i--) monsters.push(readMonster(r));
			const projectiles: Projectile[] = [];
			for (let i = r.u32(); i > 0; i--) projectiles.push(readProjectile(r));
			const events: CombatEvent[] = [];
			for (let i = r.u32(); i > 0; i--) events.push(readCombatEvent(r));
			const drops: Drop[] = [];
			for (let i = r.u32(); i > 0; i--) drops.push(readDrop(r));
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
				events,
				drops,
				progress,
				inventory,
				log,
			};
		}
		case SERVER_TAG.chat:
			return { t: 'chat', sessionId: r.u32(), handle: r.str(), text: r.str() };
		case SERVER_TAG.whisper:
			return {
				t: 'whisper',
				fromSessionId: r.u32(),
				from: r.str(),
				to: r.str(),
				text: r.str(),
			};
		case SERVER_TAG.notice:
			return { t: 'notice', text: r.str() };
		case SERVER_TAG.reject:
			return { t: 'reject', reason: r.str() };
		case SERVER_TAG.createRejected:
			return {
				t: 'createRejected',
				reason: CREATE_REJECT_REASONS[r.u8()] ?? 'invalid',
			};
		default:
			throw new Error(`unknown server message tag ${tag}`);
	}
}
