// Hand-rolled binary wire protocol for the client/server split (ADR 0006). Floats
// use f64 so encode -> decode is exact; bandwidth is trivial at this scale.

import { SHOOTER } from './constants';
import { clampCosmetics, DEFAULT_COSMETICS } from './cosmetics';
import { EMOTES } from './emote';
import type {
	ActionState,
	AttackPhase,
	Cosmetics,
	Drop,
	Effect,
	EffectKind,
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
		// Copy out of the frame buffer so the value outlives the socket's recycled
		// receive buffer (a subarray would alias it).
		const out = this.buf.slice(this.pos, this.pos + len);
		this.pos += len;
		return out;
	}
	// Lets a decoder treat a missing trailing field as absent (e.g. a legacy `hello`
	// with no protocol version) rather than reading past the buffer and throwing.
	remaining(): number {
		return this.buf.byteLength - this.pos;
	}
}

// --- Client -> server -------------------------------------------------------

// The handshake: `hello` (desired handle, release Version, SSH public key) →
// `challenge` → `proof` → `welcome`; only a verified proof joins the World (ADR
// 0004). `input` carries client-authoritative Avatar kinematics (ADR 0001) plus
// tick intents. A `skill` of 0 means none was pressed.
export type ClientMessage =
	| {
			t: 'hello';
			// Desired username on first launch; ignored for a key that already owns one —
			// the registered Handle wins (ADR 0004).
			handle: string;
			version: string;
			cosmetics: Cosmetics;
			// Equipped Weapon catalog index; joins broadcast appearance and keys the stat
			// block (ADR 0017 §14).
			weapon: number;
			// OpenSSH one-line ssh-ed25519 public key ('' = none offered; refused with a
			// human-readable reason).
			publicKey: string;
	  }
	// The ssh-agent-format signature blob over the server's nonce (domain-separated —
	// see challengePayload).
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
			// Raise the Guard this tick; the server folds it into `guardT` (ADR 0017 §5).
			guard: boolean;
			interact: boolean;
			// Dodge intent for the tick: the server loads the i-frame timer, but the hop
			// displacement is client-authoritative and never re-simulated (ADR 0001, 0017 §5).
			dodge: boolean;
			skill?: number;
	  }
	// A Zone-local chat line, relayed to the sender's Zone (#34).
	| { t: 'chat'; text: string }
	// A private message to one online Player by handle — world-wide, not Zone-local (#40).
	| { t: 'whisper'; to: string; text: string }
	// A triggered emote from the fixed set, Zone-local like chat (#38). `emote` is an
	// EMOTES id; the server drops an unknown one.
	| { t: 'emote'; emote: string }
	// A request to sell one owned Item to the Town Merchant (#267, ADR 0025). The
	// server never trusts it: re-derives the price, checks ownership, and gates on
	// standing at a Merchant — an unowned/unknown `itemId` is a silent no-op.
	| { t: 'sell'; itemId: number }
	// A request to buy one starter good from the Town Merchant (#273, ADR 0025). Carries
	// only the good's index into the fixed STARTER_GOODS catalog, never a price: the server
	// re-derives price, checks affordability, and gates on a Merchant — out-of-range or
	// unaffordable is a silent no-op.
	| { t: 'buy'; index: number }
	// Finalise brand-new Avatar creation, sent once after `welcome` reported `isNew`
	// (#302, ADR 0028): the server validates + claims the Handle, mints the Save, and
	// spawns into the starting Town. A returning account never sends it. `handle` ''
	// means "use the auto-derived placeholder" (#304).
	| { t: 'createAvatar'; handle: string; cosmetics: Cosmetics }
	// In-game Avatar re-customization ([c], Town-only) (#305, ADR 0028). Changes Cosmetics
	// only, never the Handle (set-once); the server gates on standing in a Town and shares
	// `createAvatar`'s apply path. A no-op outside a Town.
	| { t: 'setCosmetics'; cosmetics: Cosmetics };

// Four u8 catalog indices — hue, hat, nameplate, form (#35, ADR 0020). Decode clamps
// to a valid index so a garbled/forward-version value can't crash the renderer. `form`
// is written last so the older byte positions are unchanged (ADR 0024 §8).
function writeCosmetics(w: Writer, c: Cosmetics) {
	w.u8(c.hue);
	w.u8(c.hat);
	w.u8(c.nameplate);
	w.u8(c.form);
}

function readCosmetics(r: Reader): Cosmetics {
	return clampCosmetics({
		hue: r.u8(),
		hat: r.u8(),
		nameplate: r.u8(),
		form: r.u8(),
	});
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
			// Trails the pre-auth fields (#235) so an older decoder still reads a valid hello.
			w.str(msg.publicKey);
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
			// Trailing intents (ADR 0017 §5) so an older decoder that stops after `skill`
			// still reads a valid input; decode reads them back in this order.
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
			// Trails the cosmetics, append-only (#304): a #302-era client that omits it still
			// decodes (server falls back to the placeholder).
			w.str(msg.handle);
			break;
		case 'setCosmetics':
			w.u8(CLIENT_TAG.setCosmetics);
			writeCosmetics(w, msg.cosmetics);
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
			// A pre-0012 client sends an integer where we now expect a Version string; the
			// `remaining` guards keep decode from throwing on the short/garbled read, and the
			// bogus Version just fails the equality gate — the "out of date" reject we want.
			const version = r.remaining() >= 4 ? r.str() : '';
			// Trailing; a client predating them defaults to the bareheaded look (rejected by
			// the version gate regardless).
			const cosmetics =
				r.remaining() >= 4 ? readCosmetics(r) : DEFAULT_COSMETICS;
			// Trails cosmetics; a client predating it defaults to the Warrior sword.
			const weapon = r.remaining() >= 1 ? r.u8() : DEFAULT_WEAPON;
			// Trails weapon; absent decodes as '' — no key offered, which the server refuses
			// with an auth reason (not a frame error).
			const publicKey = r.remaining() >= 4 ? r.str() : '';
			return { t: 'hello', handle, version, cosmetics, weapon, publicKey };
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
			// Trailing intents (ADR 0017 §5), read back in encode order; a client predating
			// them omits the bytes, so default to no Dodge / no Guard.
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
			const cosmetics = readCosmetics(r);
			// Trails; absent (a #302-era frame) decodes as '' — server falls back to the
			// placeholder (#304).
			const handle = r.remaining() >= 4 ? r.str() : '';
			return { t: 'createAvatar', handle, cosmetics };
		}
		case CLIENT_TAG.setCosmetics: {
			const cosmetics = readCosmetics(r);
			return { t: 'setCosmetics', cosmetics };
		}
		default:
			throw new Error(`unknown client message tag ${tag}`);
	}
}

// --- Server -> client -------------------------------------------------------

// The server-owned view of one Avatar (ADR 0001): kinematics plus authoritative
// vitals. The recipient finds itself by `sessionId` to reconcile its own HP/respawn.
export interface AvatarSnapshot {
	sessionId: number;
	handle: string; // ephemeral nameplate handle
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
	// Replicated appearance so every other client renders this Avatar's weapon (ADR 0024).
	weapon: number;
	// Replicated action-state so every other client renders its swing (ADR 0017 §10).
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
	// Replicated action-state (ADR 0017 §10). Monsters broadcast idle for now; the field
	// is here so the telegraphed-offense rework needs no protocol change.
	action: ActionState;
}

// `challenge` answers `hello` with a nonce to sign; a verified `proof` earns `welcome`,
// which carries the durable Handle the key resolved to — not necessarily what the client
// asked for (ADR 0004). `snapshot` is one tick of authoritative Zone state plus this
// Player's private progress/inventory/log (respawn is just a position reset + log line).
export type ServerMessage =
	| { t: 'challenge'; nonce: Uint8Array }
	| {
			t: 'welcome';
			sessionId: number;
			zoneId: string;
			tickRate: number;
			// The durable username this connection authenticated as (#235).
			handle: string;
			// New-vs-returning verdict from the server's Save lookup — the only authority,
			// never a client flag (#302, ADR 0028). `true` holds the session authenticated but
			// UNSPAWNED until `createAvatar`; `false` is already spawned into its last Town.
			isNew: boolean;
	  }
	| {
			t: 'snapshot';
			tick: number;
			zoneId: string;
			avatars: AvatarSnapshot[];
			monsters: MonsterSnapshot[];
			projectiles: Projectile[];
			// Combat Effects this tick, already Zone-filtered and originator-suppressed for
			// this recipient (ADR 0013). Decoded Effects carry no `source` (wire-stripped).
			effects: Effect[];
			// This recipient's OWN loot Drops (#238): loot is instanced/private, so a session
			// only ever receives the Drops it owns.
			drops: Drop[];
			progress: PlayerProgress;
			inventory: Item[];
			log: string[];
	  }
	// A Zone-local chat line, event-driven not per-tick (#34). `sessionId` keys the
	// over-head Speech bubble to the sender's sprite; the handle is a display label, not
	// an identity (#59, ADR 0007).
	| { t: 'chat'; sessionId: number; handle: string; text: string }
	// A private whisper (#40) delivered to BOTH sender and recipient. `fromSessionId`
	// lets the recipient tell an incoming whisper from its own echo.
	| {
			t: 'whisper';
			fromSessionId: number;
			from: string;
			to: string;
			text: string;
	  }
	// A sender-only system line (#40): e.g. whispering a handle that is not online.
	| { t: 'notice'; text: string }
	// The server is refusing the connection and will close it — version mismatch or a
	// connection cap (ADR 0009). `reason` is surfaced before the client exits.
	| { t: 'reject'; reason: string }
	// A `createAvatar` finalise was refused — the Handle is `taken` or `invalid` (#304,
	// ADR 0028). Unlike `reject` it does NOT close the connection: the session stays
	// held-but-unspawned so the client keeps the creator open and lets the Player retry.
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

// u8 index, append-only; a forward-version index clamps to 'invalid' on decode (#304).
const CREATE_REJECT_REASONS = ['taken', 'invalid'] as const;

const ENTITY_TYPES: readonly EntityType[] = [
	'player',
	'chaser',
	'shooter',
	'brute',
];
// Append-only: the index is the wire encoding, so a new kind goes on the END (a reorder
// would remap existing Effects); a forward-version kind clamps to `blood` on decode.
const EFFECT_KINDS: readonly EffectKind[] = ['blood', 'gore', 'impact'];
// Append-only like EFFECT_KINDS; a forward-version index clamps to `idle` on decode.
const MOVE_IDS: readonly MoveId[] = ['idle', 'basic', 'dodge'];
const ATTACK_PHASES: readonly AttackPhase[] = ['windup', 'active', 'recovery'];
// Append-only emote catalog (ADR 0020 §9). `NO_EMOTE` (0xFF) is the "no active emote"
// sentinel; an unknown forward-version index decodes to null so it can't crash an older
// client (just shows idle).
const EMOTE_IDS: readonly string[] = EMOTES.map((e) => e.id);
const NO_EMOTE = 0xff;

// Per-entity action-state (ADR 0017 §10, ADR 0020 §9). `emoteT` is a oneshot's remaining
// lifetime, a loop/hold's elapsed sim-time. A forward-version move/phase/emote index
// clamps to idle/wind-up/none on decode.
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
}

function readAvatar(r: Reader): AvatarSnapshot {
	return {
		sessionId: r.u32(),
		handle: r.str(),
		cosmetics: readCosmetics(r),
		x: r.f64(),
		y: r.f64(),
		vx: r.f64(),
		vy: r.f64(),
		facing: r.i8() as Facing,
		onGround: r.bool(),
		hp: r.f64(),
		maxHp: r.f64(),
		hurtT: r.f64(),
		weapon: r.u8(),
		action: readAction(r),
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
	// Poise + Knockback that makes a heavy shot Stagger like a melee hit, appended after
	// the original fields (ADR 0017 §8).
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
	// A pre-§8 shot carried no payload fields; fall back to the SHOOTER pebble values so an
	// older snapshot decodes as the legacy shot rather than crashing on a short read.
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

// `source` is server-internal attribution stripped during snapshot-building (ADR 0013),
// so a decoded Effect never carries it. `dir` is -1 | 0 | 1, carried as a signed byte.
function writeEffect(w: Writer, e: Effect) {
	w.u8(EFFECT_KINDS.indexOf(e.kind));
	w.f64(e.x);
	w.f64(e.y);
	w.f64(e.intensity);
	w.i8(e.dir);
	// Optional RGB tint (#139), guarded by a present flag so an untinted Effect costs one
	// extra byte.
	w.bool(e.tint !== undefined);
	if (e.tint !== undefined) {
		w.u8(e.tint.r);
		w.u8(e.tint.g);
		w.u8(e.tint.b);
	}
}

function readEffect(r: Reader): Effect {
	const e: Effect = {
		kind: EFFECT_KINDS[r.u8()] ?? 'blood',
		x: r.f64(),
		y: r.f64(),
		intensity: r.f64(),
		dir: r.i8() as -1 | 0 | 1,
	};
	if (r.bool()) e.tint = { r: r.u8(), g: r.u8(), b: r.u8() };
	return e;
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

// `owner` is always the recipient (a session only receives its own Drops), carried anyway
// so a decoded Drop round-trips losslessly (#238).
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
			// Trails the pre-auth fields (#235) so an older decoder still reads a valid welcome.
			w.str(msg.handle);
			// Trails the Handle, append-only (#302); an older decoder that stops after the
			// Handle never reads it.
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
			w.u32(msg.effects.length);
			for (const e of msg.effects) writeEffect(w, e);
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
			// Trails; absent decodes as '' (pre-auth welcome) — the caller falls back to the
			// handle it asked for (#235).
			const handle = r.remaining() >= 4 ? r.str() : '';
			// Trails the Handle (#302); a welcome predating it defaults to `false` — a returning
			// account, so no creator shows.
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
			const effects: Effect[] = [];
			for (let i = r.u32(); i > 0; i--) effects.push(readEffect(r));
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
				effects,
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
