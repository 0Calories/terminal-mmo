import { expect, test } from 'bun:test';
import { DEFAULT_WEAPON } from '@mmo/core/combat';
import type { Input } from '@mmo/core/entities';
import type { ClientMessage, GameState } from '@mmo/core/protocol';
import type { Zone } from '@mmo/core/zones';
import { GameLoop, type GameLoopDeps } from '../src/game/loop';
import { flatTerrain } from './helpers';

const FRAME_MS = 16;

const FRAMES_PER_SEND = 3;

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

function zone(id: string, type: Zone['type'] = 'field'): Zone {
	return {
		id,
		type,
		terrain: flatTerrain(120, 48, 40),
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
	};
}

interface Rig {
	loop: GameLoop;
	sent: ClientMessage[];
	bursts: number;
	games: GameState[];
	syncs: number;
	net: {
		zoneId: string;
		latest: { progress: { level: number; xp: number; gold: number } } | null;
		own: {
			x: number;
			y: number;
			hp: number;
			maxHp: number;
			hurtT: number;
		} | null;
	};
	input: Input;
	modal: boolean;
	interactEdge: boolean;
	run(frames: number): void;
}

function rig(over: Partial<GameLoopDeps> = {}): Rig {
	const sent: ClientMessage[] = [];
	const games: GameState[] = [];

	const t: Rig = {
		loop: undefined as unknown as GameLoop,
		sent,
		bursts: 0,
		games,
		syncs: 0,
		net: { zoneId: '', latest: null, own: null },
		input: { ...IDLE },
		modal: false,
		interactEdge: false,
		run: (n) => {
			for (let i = 0; i < n; i++) t.loop.frame(FRAME_MS);
		},
	};

	t.loop = new GameLoop({
		net: {
			sessionId: 1,
			get zoneId() {
				return t.net.zoneId;
			},
			get latest() {
				// biome-ignore lint/suspicious/noExplicitAny: a snapshot stub, narrowed to what the loop reads
				return t.net.latest as any;
			},
			chatLog: [],
			bubbles: new Map(),
			// biome-ignore lint/suspicious/noExplicitAny: an avatar-snapshot stub
			ownAvatar: () => (t.net.own ?? undefined) as any,
			sample: () => null,
			decayBubbles: () => {},
			send: (m) => sent.push(m),
		},
		input: {
			poll: () => t.input,
			consumeInteract: () => {
				const fired = t.interactEdge;
				t.interactEdge = false;
				return fired;
			},
		},
		hud: {
			update: (g) => games.push(g),
			syncChat: () => {},
			flashLevelUp: () => {},
		},
		playfield: {
			game: null,
			emitPredicted: () => {},
			levelUpBurst: () => {
				t.bursts++;
			},
		},
		sound: { play: () => {} },
		localZone: (id) => zone(id, id === 'town' ? 'town' : 'field'),
		weapon: DEFAULT_WEAPON,
		modalOpen: () => t.modal,
		syncViews: () => {
			t.syncs++;
		},
		...over,
	});
	return t;
}

test('the loop starts in field-01 with a freshly spawned Avatar', () => {
	const t = rig();
	expect(t.loop.currentZone.id).toBe('field-01');
	expect(t.loop.avatar.weapon).toBe(DEFAULT_WEAPON);
});

test('input is sent on a fixed cadence, not once per frame', () => {
	const t = rig();
	t.run(FRAMES_PER_SEND);
	expect(t.sent).toHaveLength(1);
	t.run(FRAMES_PER_SEND);
	expect(t.sent).toHaveLength(2);
});

test('walking right moves the predicted Avatar right', () => {
	const t = rig();
	const before = t.loop.avatar.x;
	t.input = { ...IDLE, moveX: 1 };
	t.run(6);
	expect(t.loop.avatar.x).toBeGreaterThan(before);
});

test('an open modal idles the Avatar and suppresses the interact edge', () => {
	const t = rig();
	t.modal = true;
	t.input = { ...IDLE, moveX: 1, attack: true };
	t.interactEdge = true;
	const before = t.loop.avatar.x;
	t.run(FRAMES_PER_SEND);

	expect(t.loop.avatar.x).toBe(before);
	const msg = t.sent[0] as Extract<ClientMessage, { t: 'input' }>;
	expect(msg.attack).toBe(false);
	expect(msg.interact).toBe(false);
});

test('server health overrides the prediction; position does not', () => {
	const t = rig();
	t.input = { ...IDLE, moveX: 1 };
	t.run(4);
	const predictedX = t.loop.avatar.x;
	t.net.own = { x: -999, y: -999, hp: 3, maxHp: 30, hurtT: 0.5 };
	t.run(1);
	expect(t.loop.avatar.hp).toBe(3);
	expect(t.loop.avatar.maxHp).toBe(30);
	expect(t.loop.avatar.x).toBeGreaterThanOrEqual(predictedX);
});

test('a first snapshot at a high level cannot false-trigger a level-up', () => {
	const t = rig();
	t.net.latest = { progress: { level: 12, xp: 0, gold: 0 } };
	t.run(3);
	expect(t.bursts).toBe(0);
});

test('every frame hands a fresh game state to the playfield and the HUD', () => {
	const t = rig();
	t.run(3);
	expect(t.games).toHaveLength(3);
	expect(t.syncs).toBe(3);

	expect(t.games[2].player.avatar).toBe(t.loop.avatar);
});
