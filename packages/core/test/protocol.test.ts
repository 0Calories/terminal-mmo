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

// Helper to byte-craft a legacy (pre-#348) frame: tag + fields, with the hat
// carried as a raw u8 LEGACY_HAT_IDS index and NO trailing hat-id string.
function craftBytes(...parts: (number | string)[]): Uint8Array {
	const bytes: number[] = [];
	const enc = new TextEncoder();
	for (const p of parts) {
		if (typeof p === 'number') {
			bytes.push(p);
		} else {
			const b = enc.encode(p);
			const len = new Uint8Array(4);
			new DataView(len.buffer).setUint32(0, b.length);
			bytes.push(...len, ...b);
		}
	}
	return new Uint8Array(bytes);
}

test('hello round-trips the handle + release version + cosmetics + weapon + public key', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'neo',
		cosmetics: { hue: 3, hat: 'top-hat', nameplate: 5, form: 'buddy' },
		version: '0.3.0',
		weapon: 2,
		publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForWire',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('hello round-trips a non-legacy hat id (survives via the appended full-fidelity field)', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'neo',
		cosmetics: { hue: 3, hat: 'halo', nameplate: 5, form: 'buddy' },
		version: '0.3.0',
		weapon: 2,
		publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForWire',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('hello round-trips the empty (no-hat) cosmetic id', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'neo',
		cosmetics: { hue: 0, hat: '', nameplate: 0, form: 'buddy' },
		version: '0.3.0',
		weapon: 0,
		publicKey: '',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('hello round-trips a legacy hat id ("cap")', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'neo',
		cosmetics: { hue: 0, hat: 'cap', nameplate: 0, form: 'buddy' },
		version: '0.3.0',
		weapon: 0,
		publicKey: '',
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('a pre-auth hello (no trailing public key or hat id) decodes publicKey empty and hat quad-derived', () => {
	const msg: ClientMessage = {
		t: 'hello',
		handle: 'legacy',
		version: '0.3.0',
		cosmetics: { hue: 1, hat: '', nameplate: 2, form: 'buddy' },
		weapon: 1,
		publicKey: 'trailing-key-to-strip',
	};
	const encoded = encodeClientMessage(msg);
	// strip the trailing form-id field (u32 len + bytes), the trailing hat-id
	// field (u32 len + 0 bytes, since hat is ''), and the publicKey field
	// (u32 len + bytes) — the order they sit at the end of the frame.
	const keyLen = new TextEncoder().encode(msg.publicKey).length;
	const hatLen = new TextEncoder().encode(msg.cosmetics.hat).length;
	const formLen = new TextEncoder().encode(msg.cosmetics.form).length;
	const truncated = encoded.subarray(
		0,
		encoded.length - 4 - formLen - 4 - hatLen - 4 - keyLen,
	);
	expect(decodeClientMessage(truncated)).toEqual({ ...msg, publicKey: '' });
});

test('a legacy (pre-#348) hello frame — quad only, no trailing hat id — decodes cleanly', () => {
	// tag, handle, version, then the raw legacy quad (hue, hat=3 -> 'wizard', nameplate, form)
	const buf = craftBytes(1, 'forward', '0.2.0', 1, 3, 1, 0);
	expect(decodeClientMessage(buf)).toEqual({
		t: 'hello',
		handle: 'forward',
		version: '0.2.0',
		cosmetics: { hue: 1, hat: 'wizard', nameplate: 1, form: 'buddy' },
		weapon: DEFAULT_WEAPON,
		publicKey: '',
	});
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

test('a truncated hello (no version/quad/weapon/key/hat fields) decodes with defaults, not garbage', () => {
	const buf = craftBytes(1, 'legacy'); // tag, handle only
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
	const encoded = encodeClientMessage({
		t: 'hello',
		handle: 'forward',
		version: '0.3.0',
		cosmetics: { hue: 999, hat: '', nameplate: 1, form: 'buddy' },
		weapon: 1,
		publicKey: '',
	});
	expect(decodeClientMessage(encoded)).toEqual({
		t: 'hello',
		handle: 'forward',
		version: '0.3.0',
		cosmetics: { hue: 0, hat: '', nameplate: 1, form: 'buddy' },
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
		cosmetics: { hue: 4, hat: 'top-hat', nameplate: 3, form: 'buddy' },
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('createAvatar round-trips a non-legacy hat id (survives via the appended full-fidelity field)', () => {
	const msg: ClientMessage = {
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 4, hat: 'halo', nameplate: 3, form: 'buddy' },
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('a legacy (pre-#348) createAvatar frame — quad only, no trailing hat id — decodes cleanly', () => {
	// tag, quad (hue, hat=3 -> 'wizard', nameplate, form), then trailing handle
	const buf = craftBytes(9, 1, 3, 1, 0, 'Neo'); // 9 = CLIENT_TAG.createAvatar
	expect(decodeClientMessage(buf)).toEqual({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 1, hat: 'wizard', nameplate: 1, form: 'buddy' },
	});
});

test('createAvatar carries an empty typed Handle (server falls back to the placeholder)', () => {
	const msg: ClientMessage = {
		t: 'createAvatar',
		handle: '',
		cosmetics: { hue: 1, hat: '', nameplate: 2, form: 'buddy' },
	};
	expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
});

test('createAvatar clamps an out-of-range cosmetic index on decode', () => {
	const encoded = encodeClientMessage({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 999, hat: '', nameplate: 1, form: 'buddy' },
	});
	expect(decodeClientMessage(encoded)).toEqual({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 0, hat: '', nameplate: 1, form: 'buddy' },
	});
});

test('setCosmetics (client -> server) round-trips the chosen Cosmetics (#305)', () => {
	const msg: ClientMessage = {
		t: 'setCosmetics',
		cosmetics: { hue: 3, hat: 'crown', nameplate: 1, form: 'buddy' },
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('setCosmetics round-trips a non-legacy hat id (survives via the appended full-fidelity field)', () => {
	const msg: ClientMessage = {
		t: 'setCosmetics',
		cosmetics: { hue: 3, hat: 'halo', nameplate: 1, form: 'buddy' },
	};
	const decoded = decodeClientMessage(encodeClientMessage(msg));
	expect(decoded).toEqual(msg);
});

test('a legacy (pre-#348) setCosmetics frame — quad only, no trailing hat id — decodes cleanly', () => {
	// tag, quad (hue, hat=3 -> 'wizard', nameplate, form) with no trailing field
	const buf = craftBytes(10, 1, 3, 1, 0); // 10 = CLIENT_TAG.setCosmetics
	expect(decodeClientMessage(buf)).toEqual({
		t: 'setCosmetics',
		cosmetics: { hue: 1, hat: 'wizard', nameplate: 1, form: 'buddy' },
	});
});

test('setCosmetics clamps an out-of-range cosmetic index on decode (#305)', () => {
	const encoded = encodeClientMessage({
		t: 'setCosmetics',
		cosmetics: { hue: 999, hat: '', nameplate: 2, form: 'buddy' },
	});
	expect(decodeClientMessage(encoded)).toEqual({
		t: 'setCosmetics',
		cosmetics: { hue: 0, hat: '', nameplate: 2, form: 'buddy' },
	});
});

test('createAvatar round-trips a non-legacy form id (survives via the appended full-fidelity field)', () => {
	const msg: ClientMessage = {
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 4, hat: 'cap', nameplate: 3, form: 'wisp' },
	};
	expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
});

test('setCosmetics round-trips a non-legacy form id (survives via the appended full-fidelity field)', () => {
	const msg: ClientMessage = {
		t: 'setCosmetics',
		cosmetics: { hue: 3, hat: 'crown', nameplate: 1, form: 'wisp' },
	};
	expect(decodeClientMessage(encodeClientMessage(msg))).toEqual(msg);
});

test('setCosmetics with a trailing hat id but no trailing form id recovers the form from the legacy quad byte', () => {
	// Byte-craft a frame that appends the full-fidelity hat id but stops before
	// the form id (form rides only the legacy quad byte). tag(10) + quad
	// (hue=2, hat=1 -> 'cap', nameplate=1, form=0 -> 'buddy') + trailing hat.
	const buf = craftBytes(10, 2, 1, 1, 0, 'top-hat');
	expect(decodeClientMessage(buf)).toEqual({
		t: 'setCosmetics',
		cosmetics: { hue: 2, hat: 'top-hat', nameplate: 1, form: 'buddy' },
	});
});

test('a #302-era createAvatar (no trailing handle or hat id) decodes handle as empty', () => {
	const full = encodeClientMessage({
		t: 'createAvatar',
		handle: 'Neo',
		cosmetics: { hue: 2, hat: 'cap', nameplate: 3, form: 'buddy' },
	});
	// Drop the trailing form-id field (u32 len + 5 bytes for "buddy"), the
	// trailing hat-id field (u32 len + 3 bytes for "cap"), and the trailing
	// handle field (u32 len + 3 bytes for "Neo").
	const legacy = full.subarray(0, full.length - 4 - 5 - 4 - 3 - 4 - 3);
	expect(decodeClientMessage(legacy)).toEqual({
		t: 'createAvatar',
		handle: '',
		cosmetics: { hue: 2, hat: 'cap', nameplate: 3, form: 'buddy' },
	});
});

test('createRejected (server -> client) round-trips its reason (#304)', () => {
	for (const reason of ['taken', 'invalid'] as const) {
		const msg: ServerMessage = { t: 'createRejected', reason };
		expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
	}
});

test('createRejected clamps a forward-version reason to invalid on decode', () => {
	const encoded = encodeServerMessage({ t: 'createRejected', reason: 'taken' });
	encoded[1] = 200;
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
	const fresh: ServerMessage = { ...returning, isNew: true };
	expect(decodeServerMessage(encodeServerMessage(fresh))).toEqual(fresh);
});

test('a pre-auth welcome (no trailing handle) decodes handle as empty', () => {
	const encoded = encodeServerMessage({
		t: 'welcome',
		sessionId: 7,
		zoneId: 'field-01',
		tickRate: 20,
		handle: 'Trinity',
		isNew: true,
	});
	// strip trailing isNew byte + durable-handle field (u32 length prefix + bytes)
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
				cosmetics: { hue: 1, hat: 'party-hat', nameplate: 3, form: 'buddy' },
				x: 12.5,
				y: 31.25,
				vx: -22,
				vy: 0,
				facing: 1,
				onGround: true,
				hp: 80,
				maxHp: 92,
				hurtT: 0.3,
				weapon: 2,
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
		events: [
			{ kind: 'hit', targetId: 3, x: 52.5, y: 34.5, intensity: 8, dir: 1 },
		],
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

test('snapshot round-trips a non-legacy hat id on each of two avatars (per-record appended field, CONTRIBUTING §wire)', () => {
	const avatar = (sessionId: number, hat: string) => ({
		sessionId,
		handle: `h${sessionId}`,
		cosmetics: { hue: 0, hat, nameplate: 0, form: 'buddy' },
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
		action: IDLE_ACTION,
	});
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 1,
		zoneId: 'field-01',
		avatars: [avatar(1, 'halo'), avatar(2, 'cap')],
		monsters: [],
		projectiles: [],
		events: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips a non-legacy form id on each of two avatars (per-record appended field, CONTRIBUTING §wire)', () => {
	const avatar = (sessionId: number, form: string) => ({
		sessionId,
		handle: `h${sessionId}`,
		cosmetics: { hue: 0, hat: '', nameplate: 0, form },
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
		action: IDLE_ACTION,
	});
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 1,
		zoneId: 'field-01',
		avatars: [avatar(1, 'wisp'), avatar(2, 'buddy')],
		monsters: [],
		projectiles: [],
		events: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips the per-entity action-state across every phase (ADR 0017)', () => {
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
		events: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips a multi-hit CombatEvent list across every dir (ADR 0013)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 5,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		events: [
			{ kind: 'hit', targetId: 1, x: 1.5, y: 2.5, intensity: 8, dir: 1 },
			{ kind: 'hit', targetId: 2, x: 3.25, y: 4.75, intensity: 24, dir: -1 },
			{ kind: 'hit', targetId: 3, x: 9, y: 9, intensity: 12, dir: 0 },
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips a break + swat + hit CombatEvent mix (ADR 0017/0029)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 8,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		events: [
			{ kind: 'break', targetId: 1, x: 12.5, y: 7.5, intensity: 32, dir: 1 },
			{ kind: 'swat', targetId: 9, x: 4, y: 4, intensity: 7, dir: -1 },
			{ kind: 'hit', targetId: 2, x: 1, y: 1, intensity: 8, dir: 1 },
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
	if (decoded.t === 'snapshot') {
		expect(decoded.events[0].kind).toBe('break');
		expect(decoded.events[1].kind).toBe('swat');
		expect(decoded.events[2].kind).toBe('hit');
	}
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
		events: [],
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
		events: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
	if (decoded.t === 'snapshot') expect(decoded.monsters[0].type).toBe('brute');
});

test('snapshot round-trips a tinted death CombatEvent next to a hit (#139)', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 7,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		events: [
			{
				kind: 'death',
				targetId: 1,
				x: 5.5,
				y: 6.5,
				intensity: 30,
				dir: 0,
				tint: { r: 220, g: 90, b: 90 },
			},
			{ kind: 'hit', targetId: 2, x: 1, y: 1, intensity: 8, dir: 1 },
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('snapshot round-trips an empty CombatEvent list', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 0,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		events: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	expect(decodeServerMessage(encodeServerMessage(msg))).toEqual(msg);
});

test('a hit CombatEvent carrying a server-internal source does NOT survive encode -> decode', () => {
	const msg: ServerMessage = {
		t: 'snapshot',
		tick: 0,
		zoneId: 'field-01',
		avatars: [],
		monsters: [],
		projectiles: [],
		events: [
			{ kind: 'hit', targetId: 1, x: 1, y: 1, intensity: 8, dir: 1, source: 7 },
		],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	if (decoded.t !== 'snapshot') throw new Error('expected a snapshot message');
	expect(decoded.events[0]).not.toHaveProperty('source');
	expect(decoded.events[0]).toEqual({
		kind: 'hit',
		targetId: 1,
		x: 1,
		y: 1,
		intensity: 8,
		dir: 1,
	});
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
		events: [],
		progress: { level: 1, xp: 0, gold: 0 },
		drops: [],
		inventory: [],
		log: [],
	};
	const decoded = decodeServerMessage(encodeServerMessage(msg));
	expect(decoded).toEqual(msg);
});
