import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { loadZones, spriteIds } from '@mmo/assets/meta';
import { type Cosmetics, DEFAULT_COSMETICS } from '@mmo/core/entities';
import {
	canonicalPublicKey,
	challengePayload,
	encodePublicKeyLine,
	encodeSignatureBlob,
	type PlayerSave,
	type PlayerStore,
	parsePublicKeyLine,
} from '@mmo/core/persistence';
import { parseTerrain } from '@mmo/core/physics';
import {
	type AvatarSnapshot,
	type ClientMessage,
	decodeServerMessage,
	encodeClientMessage,
	type ServerMessage,
} from '@mmo/core/protocol';
import { GROUND_TOP, type Zone } from '@mmo/core/zones';
import {
	createInMemoryServer,
	createServerRuntime,
	type InMemorySession,
} from '../src/runtime';

export interface ScenarioIdentity {
	publicKey: string;
	sign(payload: Uint8Array): Uint8Array;
}

export interface AuthenticateOptions {
	identity: ScenarioIdentity;
	handle: string;
	cosmetics: Cosmetics;
	weapon?: number;
}

export interface ScenarioClient {
	readonly sessionId: number;
	authenticate(
		options: AuthenticateOptions,
	): Extract<ServerMessage, { t: 'welcome' }>;
	send(message: ClientMessage): void;
	receive(): ServerMessage[];
	take<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>;
	disconnect(): void;
}

export interface StackScenario {
	connect(): ScenarioClient;
	advanceTick(count?: number): void;
	restart(): void;
}

export interface StackScenarioOptions {
	zones?: Zone[];
	startZone?: string;
	townZone?: string;
	tickRate?: number;
	seedSaves?: readonly { publicKey: string; save: PlayerSave }[];
}

export interface JoinScenarioPlayerOptions {
	identity?: ScenarioIdentity;
	cosmetics?: Cosmetics;
	weapon?: number;
	createAvatar?: boolean;
}

export function createScenarioIdentity(): ScenarioIdentity {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const jwk = publicKey.export({ format: 'jwk' });
	const raw = new Uint8Array(Buffer.from(jwk.x as string, 'base64url'));
	return {
		publicKey: encodePublicKeyLine(raw),
		sign: (payload) => signBlob(privateKey, payload),
	};
}

export function createStackScenario(
	options: StackScenarioOptions = {},
): StackScenario {
	const saves = new Map<string, PlayerSave>(
		(options.seedSaves ?? []).map(({ publicKey, save }) => [
			persistenceKey(publicKey),
			clone(save),
		]),
	);
	const store: PlayerStore = {
		load: (key) => clone(saves.get(key)),
		save: (key, save) => saves.set(key, clone(save)),
		all: () => [...saves].map(([key, save]) => [key, clone(save)]),
		close: () => {},
	};
	const createServer = () =>
		createInMemoryServer(
			createServerRuntime({
				zones: options.zones ?? loadZones(),
				store,
				releaseVersion: 'dev',
				nonce: () => new Uint8Array(32).fill(7),
				validHatIds: spriteIds('hats'),
				validFormIds: spriteIds('forms'),
				startZone: options.startZone,
				townZone: options.townZone,
				tickRate: options.tickRate,
				log: () => {},
				logError: () => {},
			}),
		);
	let server = createServer();
	return {
		connect: () => scenarioClient(server.connect()),
		advanceTick(count = 1) {
			for (let tick = 0; tick < count; tick++) server.advanceTick();
		},
		restart() {
			server = createServer();
		},
	};
}

export function joinScenarioPlayer(
	stack: StackScenario,
	handle: string,
	options: JoinScenarioPlayerOptions = {},
): {
	client: ScenarioClient;
	identity: ScenarioIdentity;
	welcome: Extract<ServerMessage, { t: 'welcome' }>;
} {
	const identity = options.identity ?? createScenarioIdentity();
	const cosmetics = options.cosmetics ?? DEFAULT_COSMETICS;
	const client = stack.connect();
	const welcome = client.authenticate({
		identity,
		handle,
		cosmetics,
		weapon: options.weapon,
	});
	if (welcome.isNew && options.createAvatar !== false)
		client.send({ t: 'createAvatar', handle, cosmetics });
	return { client, identity, welcome };
}

export function latestScenarioSnapshot(
	client: ScenarioClient,
): Extract<ServerMessage, { t: 'snapshot' }> {
	const snapshot = client
		.receive()
		.findLast(
			(message): message is Extract<ServerMessage, { t: 'snapshot' }> =>
				message.t === 'snapshot',
		);
	if (snapshot === undefined)
		throw new Error('expected authoritative snapshot');
	return snapshot;
}

export function scenarioAvatar(
	snapshot: Extract<ServerMessage, { t: 'snapshot' }>,
	sessionId: number,
): AvatarSnapshot {
	const avatar = snapshot.avatars.find(
		(candidate) => candidate.sessionId === sessionId,
	);
	if (avatar === undefined) throw new Error(`missing Avatar ${sessionId}`);
	return avatar;
}

export function scenarioInput(
	overrides: Partial<Extract<ClientMessage, { t: 'input' }>> = {},
): Extract<ClientMessage, { t: 'input' }> {
	return {
		t: 'input',
		x: 10,
		y: GROUND_TOP - 5,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		attack: false,
		guard: false,
		interact: false,
		dodge: false,
		...overrides,
	};
}

export function scenarioZone(
	id: string,
	type: Zone['type'],
	overrides: Partial<Omit<Zone, 'id' | 'type'>> = {},
): Zone {
	const rows = Array.from({ length: 40 }, (_, y) =>
		(y >= GROUND_TOP ? '#' : '.').repeat(80),
	);
	return {
		monsters: [],
		projectiles: [],
		nextProjectileId: 1,
		spawns: [],
		respawns: [],
		nextMonsterId: 1,
		portals: [],
		npcs: [],
		drops: [],
		nextDropId: 1,
		...overrides,
		id,
		type,
		terrain: overrides.terrain ?? parseTerrain(rows),
	};
}

export function scenarioPortal(
	target: string,
	x = 10,
	arrivalX = 10,
): Zone['portals'][number] {
	const y = GROUND_TOP - 5;
	return {
		x,
		y: y - 2,
		w: 4,
		h: 7,
		target,
		arrival: { x: arrivalX, y },
	};
}

function persistenceKey(publicKey: string): string {
	const parsed = parsePublicKeyLine(publicKey);
	if (!parsed)
		throw new Error('seeded scenario save has an invalid public key');
	return canonicalPublicKey(parsed);
}

function scenarioClient(session: InMemorySession): ScenarioClient {
	const receive = () => session.receive().map(decodeServerMessage);
	const take = <T extends ServerMessage['t']>(type: T) => {
		const messages = receive();
		const message = messages.findLast(
			(candidate): candidate is Extract<ServerMessage, { t: T }> =>
				candidate.t === type,
		);
		if (message === undefined)
			throw new Error(
				`expected ${type}, received ${messages.map((candidate) => candidate.t).join(', ') || 'nothing'}`,
			);
		return message;
	};
	const send = (message: ClientMessage) =>
		session.send(encodeClientMessage(message));
	return {
		sessionId: session.sessionId,
		authenticate(options) {
			send({
				t: 'hello',
				handle: options.handle,
				version: '',
				cosmetics: options.cosmetics,
				weapon: options.weapon ?? 0,
				publicKey: options.identity.publicKey,
			});
			const challenge = take('challenge');
			send({
				t: 'proof',
				signature: options.identity.sign(challengePayload(challenge.nonce)),
			});
			return take('welcome');
		},
		send,
		receive,
		take,
		disconnect: () => session.disconnect(),
	};
}

function signBlob(privateKey: KeyObject, payload: Uint8Array): Uint8Array {
	return encodeSignatureBlob(new Uint8Array(sign(null, payload, privateKey)));
}

function clone<T>(value: T): T {
	return structuredClone(value);
}
