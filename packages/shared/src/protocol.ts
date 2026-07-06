// Binary wire protocol for the client/server split (ADR 0006). Hand-rolled over
// a DataView so client and server share one encoder/decoder and the seam is
// round-trip testable. Floats use f64 so encode -> decode is exact (bandwidth is
// trivial at this scale; quant/delta-encoding is a later concern).

import { SHOOTER } from './constants';
import { clampCosmetics, DEFAULT_COSMETICS } from './cosmetics';
import { EMOTES } from './emote';
import type {
	ActionState,
	AttackPhase,
	Cosmetics,
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
	// Unread bytes left in the frame — lets a decoder treat a missing trailing
	// field as absent (e.g. a legacy `hello` with no protocol version) instead of
	// reading past the buffer and throwing.
	remaining(): number {
		return this.buf.byteLength - this.pos;
	}
}

// --- Client -> server -------------------------------------------------------

// `hello` opens the handshake with the desired handle, the client's release
// Version (ADR 0012: the deployed server rejects a mismatch), and the SSH public
// key the client will prove control of (ADR 0004, #235). The server answers with
// a `challenge`; the client signs it and sends `proof`; only a verified proof
// joins the World (`welcome` then carries the durable Handle). `input` reports
// the client-owned Avatar kinematics (ADR 0001: position is client-authoritative)
// plus the combat intents for the tick. A `skill` of 0 means none was pressed.
export type ClientMessage =
	| {
			t: 'hello';
			// The desired username on first launch; ignored for a key that already owns
			// one (the registered Handle wins — identity is durable, ADR 0004).
			handle: string;
			version: string;
			cosmetics: Cosmetics;
			// Equipped Weapon catalog index, declared at connect like cosmetics (ADR 0017
			// §14): it joins the Avatar's broadcast appearance and keys its stat block.
			weapon: number;
			// OpenSSH one-line ssh-ed25519 public key ('' = none offered; the server
			// refuses with a human-readable reason).
			publicKey: string;
	  }
	// The signed challenge: the ssh-agent-format signature blob over the server's
	// nonce (domain-separated — see challengePayload). Answers `challenge`.
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
			// Raise the Guard this tick (ADR 0017 §5). The server folds it into the held
			// `guardT` and resolves the Block authoritatively.
			guard: boolean;
			interact: boolean;
			// Dodge intent for the tick (ADR 0017 §5): the server loads the i-frame hop
			// timer so its damage gates honour the Dodge. The hop displacement itself is
			// client-authoritative (ADR 0001) and never re-simulated server-side.
			dodge: boolean;
			skill?: number;
	  }
	// A Zone-local chat line; the server attributes it to the sender's handle and
	// relays it to the sender's Zone (#34).
	| { t: 'chat'; text: string }
	// A private, directed message to one online Player by handle (#40). Not
	// Zone-local: the server routes it world-wide to the matching session only.
	| { t: 'whisper'; to: string; text: string }
	// A triggered emote from the fixed set (#38). Zone-local like chat: the server
	// relays it to the sender's Zone, where it renders as a transient over-head
	// glyph. `emote` is an EMOTES id; the server drops an unknown one.
	| { t: 'emote'; emote: string };

// Cosmetics are three small catalog indices (#35): one u8 each. Decode clamps to a
// valid index so a forward-version / garbled value can never crash the renderer. The
// `form` index (ADR 0020) is NOT on the wire yet — only one Form exists, so it defaults
// — keeping this slice's per-frame wire cost unchanged; it joins when a second Form ships.
function writeCosmetics(w: Writer, c: Cosmetics) {
	w.u8(c.hue);
	w.u8(c.hat);
	w.u8(c.nameplate);
}

function readCosmetics(r: Reader): Cosmetics {
	return clampCosmetics({
		hue: r.u8(),
		hat: r.u8(),
		nameplate: r.u8(),
		form: DEFAULT_COSMETICS.form,
	});
}

const CLIENT_TAG = {
	hello: 1,
	input: 2,
	chat: 3,
	whisper: 4,
	emote: 5,
	proof: 6,
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
			// The offered SSH public key trails the pre-auth fields (#235), so an older
			// decoder still reads a valid hello.
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
			// Trailing intents after the legacy fields (ADR 0017 §5), so an older decoder
			// that stops after `skill` still reads a valid input: Dodge, then Guard. Decode
			// reads them back in this same order.
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
	}
	return w.finish();
}

export function decodeClientMessage(buf: Uint8Array): ClientMessage {
	const r = new Reader(buf);
	const tag = r.u8();
	switch (tag) {
		case CLIENT_TAG.hello: {
			const handle = r.str();
			// A pre-0012 client sends an integer protocol where we now expect a Version
			// string; the `remaining` guards keep decode from throwing on the resulting
			// short/garbled read, and the bogus Version simply fails the equality gate
			// (reject) — exactly the "your client is out of date" outcome we want.
			const version = r.remaining() >= 4 ? r.str() : '';
			// Cosmetics (#35) are trailing too; a client predating them defaults to the
			// bareheaded look (it is rejected by the version gate regardless).
			const cosmetics =
				r.remaining() >= 3 ? readCosmetics(r) : DEFAULT_COSMETICS;
			// Weapon (ADR 0017 §14) trails cosmetics; a client predating it defaults to
			// the Warrior sword (it is rejected by the version gate regardless).
			const weapon = r.remaining() >= 1 ? r.u8() : DEFAULT_WEAPON;
			// Public key (#235) trails weapon; absent decodes as '' — no key offered,
			// which the server refuses with its auth reason (not a frame error).
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
			// Trailing intents (ADR 0017 §5), read back in the encode order; a client
			// predating them omits the bytes, so guard each read and default: no Dodge /
			// no Guard.
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
	cosmetics: Cosmetics; // chosen hue / hat / nameplate colour (#35)
	x: number;
	y: number;
	vx: number;
	vy: number;
	facing: Facing;
	onGround: boolean;
	hp: number;
	maxHp: number;
	hurtT: number;
	// Equipped Weapon catalog index: part of replicated appearance, so every other
	// client renders this Avatar's weapon (composited sprite + accent, ADR 0024 —
	// the swing timing itself is the one shared phase machine).
	weapon: number;
	// What this Avatar is doing this tick (ADR 0017 §10): the replicated action-state
	// that lets every other client render its swing (pose + slash-arc).
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
	// Replicated action-state (ADR 0017 §10). Monsters keep their MVP behavior in
	// this slice, so they broadcast an idle action; the field is here so the
	// telegraphed Monster-offense rework needs no protocol change.
	action: ActionState;
}

// `challenge` answers `hello` with the nonce to sign (ADR 0004, #235); a
// verified `proof` earns `welcome`, which now also carries the durable Handle
// the key resolved to (the registered username — not necessarily what the
// client asked for). `snapshot` is the authoritative Zone state for one tick
// plus this Player's private progress/inventory/log (respawn shows up as a
// position reset + a log line, so it needs no dedicated field).
export type ServerMessage =
	| { t: 'challenge'; nonce: Uint8Array }
	| {
			t: 'welcome';
			sessionId: number;
			zoneId: string;
			tickRate: number;
			// The durable claimed username this connection authenticated as (#235).
			handle: string;
	  }
	| {
			t: 'snapshot';
			tick: number;
			zoneId: string;
			avatars: AvatarSnapshot[];
			monsters: MonsterSnapshot[];
			projectiles: Projectile[];
			// Combat Effects produced this tick, already filtered by Zone interest and
			// originator-suppressed for this recipient (ADR 0013). The client realizes
			// them into Particles. Decoded Effects carry no `source` (wire-stripped).
			effects: Effect[];
			progress: PlayerProgress;
			inventory: Item[];
			log: string[];
	  }
	// A Zone-local chat line relayed to every session in the sender's Zone,
	// attributed to the sender's Handle (#34). Event-driven, not per-tick.
	// `sessionId` keys the over-head Speech bubble to the sender's sprite (#59,
	// ADR 0007) — the handle is a display label, not an identity.
	| { t: 'chat'; sessionId: number; handle: string; text: string }
	// A private whisper (#40) delivered to BOTH the sender and the recipient, so
	// each sees the line in its log. `fromSessionId` lets the recipient tell an
	// incoming whisper from its own echo (handles are display labels, not identity).
	| {
			t: 'whisper';
			fromSessionId: number;
			from: string;
			to: string;
			text: string;
	  }
	// A sender-only system line (#40): e.g. whispering a handle that is not online.
	| { t: 'notice'; text: string }
	// The server is refusing the connection and will close it (ADR 0009): a
	// protocol-version mismatch, or a connection cap (global / per-IP). `reason` is
	// a human-readable line the client surfaces before exiting.
	| { t: 'reject'; reason: string };

const SERVER_TAG = {
	welcome: 1,
	snapshot: 2,
	chat: 3,
	reject: 4,
	whisper: 5,
	notice: 6,
	challenge: 7,
} as const;

const ENTITY_TYPES: readonly EntityType[] = [
	'player',
	'chaser',
	'shooter',
	'brute',
];
// Append-only: indices are the wire encoding, so a new kind goes on the END (a
// reorder would remap existing Effects). A forward-version kind clamps to `blood`
// on decode (see readEffect) so a newer server can't crash an older client.
const EFFECT_KINDS: readonly EffectKind[] = ['blood', 'gore', 'impact'];
// Append-only (like EFFECT_KINDS): the index is the wire encoding, so a new move
// goes on the END and a forward-version index clamps to `idle` on decode.
const MOVE_IDS: readonly MoveId[] = ['idle', 'basic', 'dodge'];
const ATTACK_PHASES: readonly AttackPhase[] = ['windup', 'active', 'recovery'];
// Append-only emote catalog for the wire (ADR 0020 §9): the index is the encoding, so a
// new emote goes on the END. `NO_EMOTE` (0xFF) is the "no active emote" sentinel; a
// forward-version index that isn't in the catalog decodes to null, so a newer server's
// emote can never crash an older client's renderer (it just shows idle).
const EMOTE_IDS: readonly string[] = EMOTES.map((e) => e.id);
const NO_EMOTE = 0xff;

// The per-entity action-state (ADR 0017 §10, extended by ADR 0020 §9): move + phase as
// catalog-index bytes, phase progress as an f64 (exact round-trip), flags as a u8
// bitfield, then the active emote — its catalog index (0xFF == none) + its `emoteT` clock
// as an f64 (a oneshot's remaining lifetime, a loop/hold's elapsed sim-time). A forward-
// version move/phase/emote index clamps to idle/wind-up/none on decode so a newer server
// can never crash an older client's renderer.
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
	// The first-class hit payload (ADR 0017 §8): the Poise + Knockback that makes a heavy
	// shot Stagger like a melee hit, appended after the original fields.
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
	// A pre-§8 shot carried none of the payload fields; fall back to the SHOOTER pebble
	// values so an older snapshot decodes as the legacy hostile shot rather than crashing
	// on a short read.
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

// An Effect on the wire is the pure { kind, x, y, intensity, dir } — `source` is
// server-internal attribution stripped during snapshot-building (ADR 0013), so a
// decoded Effect never carries it. `dir` is -1 | 0 | 1, carried as a signed byte.
function writeEffect(w: Writer, e: Effect) {
	w.u8(EFFECT_KINDS.indexOf(e.kind));
	w.f64(e.x);
	w.f64(e.y);
	w.f64(e.intensity);
	w.i8(e.dir);
	// Optional RGB tint (#139), guarded by a present flag so an untinted Effect
	// costs one extra byte. Each channel is a u8.
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
			// The durable Handle trails the pre-auth fields (#235), so an older decoder
			// still reads a valid welcome.
			w.str(msg.handle);
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
			// Durable Handle (#235) trails; absent decodes as '' (a pre-auth welcome) —
			// the caller falls back to the handle it asked for.
			const handle = r.remaining() >= 4 ? r.str() : '';
			return { t: 'welcome', sessionId, zoneId, tickRate, handle };
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
		default:
			throw new Error(`unknown server message tag ${tag}`);
	}
}
