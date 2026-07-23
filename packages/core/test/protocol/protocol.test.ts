import { describe, expect, test } from 'bun:test';
import { ACTION_FLAG, DEFAULT_WEAPON, IDLE_ACTION } from '../../src/combat';
import { DEFAULT_COSMETICS } from '../../src/entities';
import type { ClientMessage, ServerMessage } from '../../src/protocol';
import {
	decodeClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	encodeServerMessage,
} from '../../src/protocol';

function craftBytes(...parts: (number | string)[]): Uint8Array {
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	for (const part of parts) {
		if (typeof part === 'number') bytes.push(part);
		else {
			const value = encoder.encode(part);
			const length = new Uint8Array(4);
			new DataView(length.buffer).setUint32(0, value.length);
			bytes.push(...length, ...value);
		}
	}
	return new Uint8Array(bytes);
}

const cosmetics = {
	hue: 3,
	hat: 'future-hat',
	nameplate: 2,
	form: 'future-form',
};

describe('wire message round-trips', () => {
	const signature = new Uint8Array(83).map((_, i) => (i * 7) & 0xff);
	const clientMessages: readonly ClientMessage[] = [
		{
			t: 'hello',
			handle: 'neo',
			version: '0.3.0',
			cosmetics,
			weapon: 2,
			publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForWire',
		},
		{ t: 'proof', signature },
		{
			t: 'input',
			x: 12.5,
			y: 31.25,
			vx: -22,
			vy: 7.5,
			facing: -1,
			onGround: true,
			attack: true,
			guard: true,
			interact: true,
			dodge: true,
			skill: 1,
		},
		{ t: 'chat', text: 'hello field 👋' },
		{ t: 'whisper', to: 'Trinity', text: 'meet me 🐇' },
		{ t: 'emote', emote: 'wave' },
		{ t: 'sell', itemId: 4242 },
		{ t: 'buy', index: 2 },
		{ t: 'createAvatar', handle: 'Neo', cosmetics },
		{ t: 'setCosmetics', cosmetics },
	];

	for (const message of clientMessages)
		test(`client ${message.t}`, () => {
			expect(decodeClientMessage(encodeClientMessage(message))).toEqual(
				message,
			);
		});

	const serverMessages: readonly ServerMessage[] = [
		{ t: 'challenge', nonce: new Uint8Array(32).fill(7) },
		{
			t: 'whisper',
			fromSessionId: 7,
			from: 'neo',
			to: 'trinity',
			text: 'follow the white rabbit',
		},
		{ t: 'createRejected', reason: 'taken' },
		{ t: 'createRejected', reason: 'invalid' },
		{ t: 'notice', text: 'No player named "ghost" is online.' },
		{
			t: 'welcome',
			sessionId: 7,
			zoneId: 'field-01',
			tickRate: 20,
			handle: 'Trinity',
			isNew: false,
		},
		{
			t: 'chat',
			sessionId: 42,
			handle: 'neo',
			text: 'gg wp',
		},
		{ t: 'reject', reason: 'client out of date' },
	];

	for (const message of serverMessages)
		test(`server ${message.t}`, () => {
			expect(decodeServerMessage(encodeServerMessage(message))).toEqual(
				message,
			);
		});
});

describe('required legacy and truncated wire compatibility', () => {
	test('an oldest hello containing only its tag and Handle receives safe defaults', () => {
		expect(decodeClientMessage(craftBytes(1, 'legacy'))).toEqual({
			t: 'hello',
			handle: 'legacy',
			version: '',
			cosmetics: DEFAULT_COSMETICS,
			weapon: DEFAULT_WEAPON,
			publicKey: '',
		});
	});

	test('pre-#348 quad-only cosmetic records recover their frozen legacy ids', () => {
		expect(
			decodeClientMessage(craftBytes(1, 'legacy', '0.2.0', 1, 3, 1, 0)),
		).toEqual({
			t: 'hello',
			handle: 'legacy',
			version: '0.2.0',
			cosmetics: { hue: 1, hat: 'wizard', nameplate: 1, form: 'buddy' },
			weapon: DEFAULT_WEAPON,
			publicKey: '',
		});
		expect(decodeClientMessage(craftBytes(9, 1, 3, 1, 0, 'Neo'))).toEqual({
			t: 'createAvatar',
			handle: 'Neo',
			cosmetics: { hue: 1, hat: 'wizard', nameplate: 1, form: 'buddy' },
		});
		expect(decodeClientMessage(craftBytes(10, 1, 3, 1, 0))).toEqual({
			t: 'setCosmetics',
			cosmetics: { hue: 1, hat: 'wizard', nameplate: 1, form: 'buddy' },
		});
	});

	test('a trailing hat without a trailing form falls back to the legacy form byte', () => {
		expect(
			decodeClientMessage(craftBytes(10, 2, 1, 1, 0, 'future-hat')),
		).toEqual({
			t: 'setCosmetics',
			cosmetics: {
				hue: 2,
				hat: 'future-hat',
				nameplate: 1,
				form: 'buddy',
			},
		});
	});

	test('a #302-era createAvatar without appended Handle or ids remains decodable', () => {
		const full = encodeClientMessage({
			t: 'createAvatar',
			handle: 'Neo',
			cosmetics: { hue: 2, hat: 'cap', nameplate: 3, form: 'buddy' },
		});
		const legacy = full.subarray(0, full.length - 4 - 5 - 4 - 3 - 4 - 3);
		expect(decodeClientMessage(legacy)).toEqual({
			t: 'createAvatar',
			handle: '',
			cosmetics: { hue: 2, hat: 'cap', nameplate: 3, form: 'buddy' },
		});
	});

	test('a welcome without appended identity fields receives old-client defaults', () => {
		const encoded = encodeServerMessage({
			t: 'welcome',
			sessionId: 7,
			zoneId: 'field-01',
			tickRate: 20,
			handle: 'Trinity',
			isNew: true,
		});
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

	test('unknown enum bytes clamp to safe defaults', () => {
		const hello = encodeClientMessage({
			t: 'hello',
			handle: 'forward',
			version: 'next',
			cosmetics: { ...DEFAULT_COSMETICS, hue: 999 },
			weapon: DEFAULT_WEAPON,
			publicKey: '',
		});
		expect(decodeClientMessage(hello)).toEqual(
			expect.objectContaining({ cosmetics: DEFAULT_COSMETICS }),
		);

		const rejected = encodeServerMessage({
			t: 'createRejected',
			reason: 'taken',
		});
		rejected[1] = 200;
		expect(decodeServerMessage(rejected)).toEqual({
			t: 'createRejected',
			reason: 'invalid',
		});
	});
});

function avatar(
	sessionId: number,
	overrides: Partial<
		Extract<ServerMessage, { t: 'snapshot' }>['avatars'][number]
	> = {},
): Extract<ServerMessage, { t: 'snapshot' }>['avatars'][number] {
	return {
		sessionId,
		handle: `player-${sessionId}`,
		cosmetics: {
			hue: sessionId,
			hat: `full-fidelity-hat-${sessionId}`,
			nameplate: sessionId,
			form: `full-fidelity-form-${sessionId}`,
		},
		x: sessionId * 2,
		y: 31,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		hp: 80,
		maxHp: 100,
		hurtT: 0,
		weapon: DEFAULT_WEAPON,
		action: IDLE_ACTION,
		...overrides,
	};
}

function comprehensiveSnapshot(): Extract<ServerMessage, { t: 'snapshot' }> {
	return {
		t: 'snapshot',
		tick: 1234,
		zoneId: 'field-01',
		avatars: [
			avatar(1, {
				action: {
					move: 'basic',
					phase: 'windup',
					progress: 0.25,
					flags: 0,
					emote: 'wave',
					emoteT: 1.25,
				},
			}),
			avatar(2, {
				action: {
					...IDLE_ACTION,
					move: 'basic',
					phase: 'active',
					flags: ACTION_FLAG.guarding,
				},
			}),
			avatar(3, {
				action: { ...IDLE_ACTION, move: 'basic', phase: 'recovery' },
			}),
		],
		monsters: [
			{
				id: 3,
				type: 'brute',
				x: 50,
				y: 32,
				vx: 0,
				vy: 1.5,
				facing: -1,
				onGround: false,
				hp: 10,
				maxHp: 16,
				hurtT: 0,
				action: { ...IDLE_ACTION, flags: ACTION_FLAG.staggered },
			},
			{
				id: 4,
				type: 'slime',
				x: 12,
				y: 32,
				vx: 6,
				vy: -2,
				facing: 1,
				onGround: false,
				hp: 24,
				maxHp: 24,
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
			{ kind: 'hit', targetId: 1, x: 1, y: 2, intensity: 8, dir: 1 },
			{ kind: 'break', targetId: 2, x: 3, y: 4, intensity: 12, dir: -1 },
			{ kind: 'swat', targetId: 4, x: 7, y: 8, intensity: 7, dir: 1 },
			{
				kind: 'death',
				targetId: 5,
				x: 9,
				y: 10,
				intensity: 30,
				dir: 0,
				tint: { r: 220, g: 90, b: 90 },
			},
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
					base: 'Test Vest',
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
				base: 'Test Sword',
				slot: 'weapon',
				rarity: 'rare',
				affixes: [{ stat: 'str', value: 4 }],
			},
		],
		log: ['A durable log entry.'],
	};
}

describe('snapshot wire contract', () => {
	test('round-trips authoritative world state, owner-private state, actions, and every encoded CombatEvent kind', () => {
		const message = comprehensiveSnapshot();
		expect(decodeServerMessage(encodeServerMessage(message))).toEqual(message);
	});

	test('round-trips an empty Zone state', () => {
		const message: ServerMessage = {
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
		expect(decodeServerMessage(encodeServerMessage(message))).toEqual(message);
	});

	test('strips the server-internal CombatEvent source field', () => {
		const message = comprehensiveSnapshot();
		message.events = [
			{
				kind: 'hit',
				targetId: 1,
				x: 1,
				y: 1,
				intensity: 8,
				dir: 1,
				source: 7,
			},
		];
		const decoded = decodeServerMessage(encodeServerMessage(message));
		if (decoded.t !== 'snapshot') throw new Error('expected a snapshot');
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
});
