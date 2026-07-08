import { expect, test } from 'bun:test';
import type { ClientMessage, ServerMessage } from '../src';
import {
	ACTION_FLAG,
	DEFAULT_COSMETICS,
	DEFAULT_WEAPON,
	decodeClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	encodeServerMessage,
	IDLE_ACTION,
} from '../src';

test('hello round-trips the handle + release version + cosmetics + weapon + public key', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'neo',
		// `form` rides the handshake (ADR 0020). Form 2 (wisp) is drafted out, so 0 is the only
		// valid Form for now; a persisted higher index clamps to 0 (covered by clampCosmetics).
		cosmetics: { hue: 3, hat: 2, nameplate: 5, form: 0 },
		version: '0.3.0',
		weapon: 2,
		publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForWire',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('a pre-auth hello (no trailing public key) decodes publicKey as empty', () => {
	// Built by hand at the pre-#235 layout (through the weapon byte): decode must
	// not throw, and the absent key becomes '' — which the server refuses with its
	// human-readable auth reason rather than a frame error.
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'legacy',
		version: '0.3.0',
		cosmetics: { hue: 1, hat: 0, nameplate: 2, form: 0 },
		weapon: 1,
		publicKey: 'trailing-key-to-strip',
	};
	const encoded = encodeClientMessage(msg);
	// Strip the trailing publicKey field (u32 length prefix + bytes).
	const keyLen = new TextEncoder().encode(msg.publicKey).length;
	const truncated = encoded.subarray(0, encoded.length - 4 - keyLen);
	expect(decodeClientMessage(truncated)).toEqual({ ...msg, publicKey: '' });
});

test('proof (client -> server) round-trips the signature bytes', () => {
	const signature = new Uint8Array(83).map((_, i) => (i * 7) & 0xff);
	const msg: ClientMessage = { t: 'proof', signature };
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('challenge (server -> client) round-trips the nonce bytes', () => {
	const nonce = new Uint8Array(32).map((_, i) => (i * 13) & 0xff);
	const msg: ServerMessage = { t: 'challenge', nonce };
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('a truncated hello (no version field) decodes to empty version + default cosmetics + weapon', () => {
	// Hand-roll a hello with only tag(1) + u32 length-prefixed handle and nothing
	// after: decode must not throw, and the absent Version becomes '' — which fails
	// the server's equality gate cleanly.
	const handle = new TextEncoder().encode('legacy');
	const buf = new Uint8Array(1 + 4 + handle.length);
	buf[0] = 1; // CLIENT_TAG.hello
	new DataView(buf.buffer).setUint32(1, handle.length);
	buf.set(handle, 5);
	expect(decodeClientMessage(buf)).toEqual({
		t: 'hello',
		handle: 'legacy',
		version: '',
		cosmetics: DEFAULT_COSMETICS,
		weapon: DEFAULT_WEAPON,
		publicKey: '',
	});
});

test('hello clamps an out-of-range cosmetic index to the default on decode', () => {
	// A hello whose hat id is past the catalog: decode must not throw and the bad
	// field falls back to 0 (the renderer is never handed a stray index). Built via
	// the encoder so the (length-prefixed) Version field stays in sync with the wire.
	const encoded = encodeClientMessage({
		t: 'hello',
		handle: 'forward',
		version: '0.3.0',
		// Both the hat and the (now-on-the-wire) form ids are past their catalogs; each
		// must fall back to 0 on decode so the renderer is never handed a stray index.
		cosmetics: { hue: 2, hat: 250, nameplate: 1, form: 250 },
		weapon: 1,
		publicKey: '',
	});
	expect(decodeClientMessage(encoded)).toEqual({
		t: 'hello',
		handle: 'forward',
		version: '0.3.0',
		cosmetics: { hue: 2, hat: 0, nameplate: 1, form: 0 },
		weapon: 1,
		publicKey: '',
	});
});

test('input round-trips reported kinematics + combat intents', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 12.5,
		y: 31.25,
		vx: -22,
		vy: 7.5,
		facing: -1,
		onGround: true,
		attack: true,
		guard: false,
		interact: false,
		dodge: true,
		skill: 1,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('input round-trips with no skill intent', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: false,
		attack: false,
		guard: false,
		interact: false,
		dodge: false,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('input round-trips the interact (portal) intent', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 24,
		y: 30,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		attack: false,
		guard: false,
		interact: true,
		dodge: false,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('input round-trips the dodge + Guard intents (ADR 0017 §5)', () => {
	const msg: ClientMessage = {
		t: 'input',
		x: 5,
		y: 6,
		vx: 1,
		vy: 2,
		facing: -1,
		onGround: true,
		attack: false,
		guard: true,
		interact: false,
		dodge: true,
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('chat (client -> server) round-trips the message text', () => {
	const msg: ClientMessage = { t: 'chat', text: 'hello field 👋' };
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('whisper (client -> server) round-trips the target handle + text', () => {
	const msg: ClientMessage = {
		t: 'whisper',
		to: 'Trinity',
		text: 'meet me 🐇',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('whisper (server -> client) round-trips sender session + both handles + text', () => {
	const msg: ServerMessage = {
		t: 'whisper',
		fromSessionId: 7,
		from: 'neo',
		to: 'trinity',
		text: 'follow the white rabbit',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('emote (client -> server) round-trips the trigger id (#38, ADR 0020 §9)', () => {
	// The client->server `/em` trigger is retained; the server->client relay is gone —
	// the active emote now rides the snapshot action-state instead (see the snapshot test).
	const msg: ClientMessage = { t: 'emote', emote: 'wave' };
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('sell (client -> server) round-trips the Item id (#267, ADR 0025)', () => {
	const msg: ClientMessage = { t: 'sell', itemId: 4242 };
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('buy (client -> server) round-trips the catalog index (#273, ADR 0025)', () => {
	const msg: ClientMessage = { t: 'buy', index: 2 };
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('createAvatar (client -> server) round-trips the typed Handle + chosen Cosmetics (#302, #304)', () => {
	const msg: ClientMessage = {
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 4, hat: 1, nameplate: 3, form: 0 },
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('createAvatar carries an empty typed Handle (server falls back to the placeholder)', () => {
	// The empty-field case (#304): the client sends '' when the Player leaves the field blank;
	// it must round-trip as '' so the server re-applies the auto-derived placeholder.
	const msg: ClientMessage = {
		t: 'createAvatar',
		handle: '',
		cosmetics: { hue: 1, hat: 0, nameplate: 2, form: 0 },
	};
	expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
});

test('createAvatar clamps an out-of-range cosmetic index on decode', () => {
	// Cosmetics decode is defensive like `hello`: a garbled/forward-version index falls back
	// to 0 per field so the renderer is never handed a stray index — the same trust boundary.
	const encoded = encodeClientMessage({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 2, hat: 250, nameplate: 1, form: 250 },
	});
	expect(decodeClientMessage(encoded)).toEqual({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 2, hat: 0, nameplate: 1, form: 0 },
	});
});

test('setCosmetics (client -> server) round-trips the chosen Cosmetics (#305)', () => {
	const msg: ClientMessage = {
		t: 'setCosmetics',
		cosmetics: { hue: 3, hat: 2, nameplate: 1, form: 0 },
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('setCosmetics clamps an out-of-range cosmetic index on decode (#305)', () => {
	// Cosmetics decode is defensive at the trust boundary: a garbled/forward-version index falls
	// back to 0 per field, so the server never applies a stray index to the live Avatar.
	const encoded = encodeClientMessage({
		t: 'setCosmetics',
		cosmetics: { hue: 4, hat: 250, nameplate: 2, form: 250 },
	});
	expect(decodeClientMessage(encoded)).toEqual({
		t: 'setCosmetics',
		cosmetics: { hue: 4, hat: 0, nameplate: 2, form: 0 },
	});
});

test('a #302-era createAvatar (no trailing handle) decodes handle as empty', () => {
	// The typed Handle (#304) is append-only after the cosmetics, so a frame that predates it
	// (just tag + 4 cosmetic bytes) must decode without throwing and yield handle: '' — the
	// server then falls back to the auto-derived placeholder.
	const full = encodeClientMessage({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 2, hat: 1, nameplate: 3, form: 0 },
	});
	// Drop the trailing handle field (u32 length prefix + 3 bytes for "Neo").
	const legacy = full.subarray(0, full.length - 4 - 3);
	expect(decodeClientMessage(legacy)).toEqual({
		t: 'createAvatar',
		handle: '',
		cosmetics: { hue: 2, hat: 1, nameplate: 3, form: 0 },
	});
});

test('createRejected (server -> client) round-trips its reason (#304)', () => {
	for (const reason of ['taken', 'invalid'] as const) {
		const msg: ServerMessage = { t: 'createRejected', reason };
		expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
	}
});

test('createRejected clamps a forward-version reason to invalid on decode', () => {
	// The reason is a u8 index, append-only; an unknown index (a newer server) must decode to
	// 'invalid' so an older client can never crash on it.
	const encoded = encodeServerMessage({ t: 'createRejected', reason: 'taken' });
	encoded[1] = 200; // corrupt the reason index to a forward-version value
	expect(decodeServerMessage(encoded)).toEqual({
		t: 'createRejected',
		reason: 'invalid',
	});
});

test('notice (server -> client) round-trips the sender-only system line', () => {
	const msg: ServerMessage = {
		t: 'notice',
		text: 'No player named "ghost" is online.',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('welcome round-trips the session, zone, tick rate, durable handle, and isNew verdict', () => {
	const returning: ServerMessage = {
		t: 'welcome',
		sessionId: 7,
		zoneId: 'field-01',
		tickRate: 20,
		handle: 'Trinity',
		isNew: false,
	};
	expect(decodeServerMessage(encodeServerMessage(returning))).toEqual(
		returning,
	);
	// The new-account verdict (#302) round-trips as its own value, not folded into a default.
	const fresh: ServerMessage = { ...returning, isNew: true };
	expect(decodeServerMessage(encodeServerMessage(fresh))).toEqual(fresh);
});

test('a pre-auth welcome (no trailing handle) decodes handle as empty', () => {
	// Strip the trailing durable-handle field (u32 length prefix + bytes): decode
	// must not throw, and the absent handle becomes '' (caller falls back to its
	// requested handle).
	const encoded = encodeServerMessage({
		t: 'welcome',
		sessionId: 7,
		zoneId: 'field-01',
		tickRate: 20,
		handle: 'Trinity',
		isNew: true,
	});
	// Strip the trailing isNew byte (#302) AND the durable-handle field (u32 length prefix +
	// bytes), leaving a pre-auth welcome: decode must not throw, the absent handle becomes ''
	// and the absent isNew defaults to false (a returning account, so no creator shows).
	const truncated = encoded.subarray(
		0,
		encoded.length - 1 - 4 - new TextEncoder().encode('Trinity').length,
	);
	expect(decodeServerMessage(truncated)).toEqual({
		t: 'welcome',
		sessionId: 7,
		zoneId: 'field-01',
		tickRate: 20,
		handle: '',
		isNew: false,
	});
});

test('chat (server -> client) round-trips the sender session, handle, and text', () => {
	const msg: ServerMessage = {
		t: 'chat',
		sessionId: 42,
		handle: 'neo',
		text: 'gg wp',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('snapshot round-trips authoritative zone state + owner-private fields', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 1234,
		zoneId: 'field-01',
		avatars: [
			{
				sessionId: 7,
				handle: 'neo',
				// `form` replicates in the snapshot so every observer sees the chosen Avatar Form
				// (ADR 0020). Form 2 (wisp) is drafted out, so 0 is the only valid Form for now.
				cosmetics: { hue: 1, hat: 4, nameplate: 3, form: 0 },
				x: 12.5,
				y: 31.25,
				vx: -22,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 80,
				maxHp: 92,
				hurtT: 0.3,
				// Equipped Weapon index joins the broadcast appearance (ADR 0017 §14).
				weapon: 2,
				// Mid-swing action-state (ADR 0017 §10) carrying an active body emote (ADR
				// 0020 §9) — exercises a non-idle, emoting round-trip.
				action: {
					move: 'basic',
					phase: 'active',
					progress: 0.5,
					flags: 0,
					emote: 'wave',
					emoteT: 1.25,
				},
			},
		],
		monsters: [
			{
				id: 3,
				type: 'shooter',
				x: 50,
				y: 32,
				vx: 0,
				vy: 1.5,
				facing: -1,
				onGround: false,
				hp: 10,
				maxHp: 16,
				hurtT: 0,
				action: IDLE_ACTION,
			},
		],
		projectiles: [
			{
				id: 9,
				x: 48,
				y: 33,
				vx: -36,
				vy: 0,
				life: 2.4,
				damage: 7,
				poiseDamage: 6,
				knockback: 30,
				knockbackUp: 10,
			},
		],
		effects: [{ kind: 'blood', x: 52.5, y: 34.5, intensity: 8, dir: 1 }],
		// An in-world, owner-private loot Drop (#238) resting in the Zone.
		drops: [
			{
				id: 4,
				owner: 7,
				x: 48.5,
				y: 29,
				w: 9,
				h: 5,
				ttl: 27.5,
				item: {
					id: 2,
					base: 'Leather Vest',
					slot: 'armor',
					rarity: 'epic',
					affixes: [{ stat: 'hp', value: 6 }],
				},
			},
		],
		progress: { level: 3, xp: 17, gold: 42 },
		inventory: [
			{
				id: 1,
				base: 'Iron Sword',
				slot: 'weapon',
				rarity: 'rare',
				affixes: [
					{ stat: 'str', value: 4 },
					{ stat: 'crit', value: 2 },
				],
			},
		],
		log: ['Looted rare Iron Sword.', 'Level up! Now level 3.'],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('snapshot round-trips the per-entity action-state across every phase (ADR 0017)', () => {
	// Each Avatar carries a different swing phase + progress, and a Monster carries
	// idle — encode/decode must preserve the move/phase/progress/flags exactly.
	const action = (over: Partial<typeof IDLE_ACTION>): typeof IDLE_ACTION => ({
		...IDLE_ACTION,
		move: 'basic',
		...over,
	});
	const avatar = (sessionId: number, act: typeof IDLE_ACTION) => ({
		sessionId,
		handle: `h${sessionId}`,
		cosmetics: DEFAULT_COSMETICS,
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		facing: 1 as const,
		onGround: true,
		hp: 1,
		maxHp: 1,
		hurtT: 0,
		weapon: DEFAULT_WEAPON,
		action: act,
	});
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 9,
		zoneId: 'field-01',
		avatars: [
			avatar(1, action({ phase: 'windup', progress: 0 })),
			avatar(2, action({ phase: 'active', progress: 0.25, flags: 3 })),
			avatar(3, action({ phase: 'recovery', progress: 0.99 })),
			avatar(4, IDLE_ACTION),
		],
		monsters: [],
		projectiles: [],
		effects: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips a multi-Effect list across every dir (ADR 0013)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 5,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		effects: [
			{ kind: 'blood', x: 1.5, y: 2.5, intensity: 8, dir: 1 },
			{ kind: 'blood', x: 3.25, y: 4.75, intensity: 24, dir: -1 },
			{ kind: 'blood', x: 9, y: 9, intensity: 12, dir: 0 }, // radial (death)
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips the impact Poise-break Effect kind (ADR 0017)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 8,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		effects: [
			{ kind: 'impact', x: 12.5, y: 7.5, intensity: 32, dir: 1 },
			{ kind: 'impact', x: 4, y: 4, intensity: 32, dir: -1 },
			{ kind: 'blood', x: 1, y: 1, intensity: 8, dir: 1 }, // the existing kinds still round-trip
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
	if (decoded.t === 'snapshot') expect(decoded.effects[0].kind).toBe('impact');
});

test('snapshot round-trips a Monster carrying the staggered action-flag (ADR 0017)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 9,
		zoneId: 'field-01',
		avatars: [],
		monsters: [
			{
				id: 3,
				type: 'chaser',
				x: 50,
				y: 32,
				vx: 0,
				vy: 0,
				facing: -1,
				onGround: true,
				hp: 10,
				maxHp: 24,
				hurtT: 0,
				action: { ...IDLE_ACTION, flags: ACTION_FLAG.staggered },
			},
		],
		projectiles: [],
		effects: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
	if (decoded.t === 'snapshot')
		expect(decoded.monsters[0].action.flags & ACTION_FLAG.staggered).toBe(
			ACTION_FLAG.staggered,
		);
});

test('snapshot round-trips the brute entity type across the wire (CONTRIBUTING §wire, #237)', () => {
	// The brute joins the END of ENTITY_TYPES (append-only, CONTRIBUTING §2); prove its
	// type index encodes and decodes so a mid-swing brute replicates without mis-decoding.
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 42,
		zoneId: 'field-01',
		avatars: [],
		monsters: [
			{
				id: 4,
				type: 'brute',
				x: 40,
				y: 32,
				vx: 0,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 60,
				maxHp: 60,
				hurtT: 0,
				action: {
					move: 'basic',
					phase: 'windup',
					progress: 0.5,
					flags: 0,
					emote: null,
					emoteT: 0,
				},
			},
		],
		projectiles: [],
		effects: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
	if (decoded.t === 'snapshot') expect(decoded.monsters[0].type).toBe('brute');
});

test('snapshot round-trips a tinted gore death Effect (#139)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 7,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		effects: [
			{
				kind: 'gore',
				x: 5.5,
				y: 6.5,
				intensity: 30,
				dir: 0,
				tint: { r: 220, g: 90, b: 90 },
			},
			{ kind: 'blood', x: 1, y: 1, intensity: 8, dir: 1 }, // untinted blood still round-trips
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips an empty Effects list', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 0,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		effects: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('reject round-trips the human-readable reason', () => {
	const msg: ServerMessage = {
		t: 'reject',
		reason: 'client out of date',
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});

test('snapshot round-trips when the zone is empty', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 0,
		zoneId: 'town-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		effects: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});
