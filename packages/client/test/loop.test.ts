import { expect, test } from 'bun:test';
import type { CombatEvent } from '@mmo/core/combat';
import { DEFAULT_WEAPON } from '@mmo/core/combat';
import type { Input } from '@mmo/core/entities';
import { EMOTES } from '@mmo/core/entities';
import type { ClientMessage } from '@mmo/core/protocol';
import type { GameState, Zone } from '@mmo/core/world';
import { GameLoop, type GameLoopDeps } from '../src/game/loop';
import { flatTerrain } from './helpers';

const FRAME_MS = 16;
// 1000/30 ms per send: the third 16ms frame is the first to cross it.
const FRAMES_PER_SEND = 3;

const IDLE: Input = {
	moveX: 0,
	jump: false,
	attack: false,
	guard: false,
	interact: false,
};

// Tall enough to hold SPAWN.y with ground beneath it, else the Avatar spawns out of the world.
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
	sounds: string[];
	emitted: CombatEvent[][];
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
	const sounds: string[] = [];
	const emitted: CombatEvent[][] = [];
	const games: GameState[] = [];

	const t: Rig = {
		loop: undefined as unknown as GameLoop,
		sent,
		sounds,
		emitted,
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
			flashLevelUp: () => sounds.push('flash'),
		},
		playfield: {
			game: null,
			emitPredicted: (fx) => emitted.push(fx),
			levelUpBurst: () => {
				t.bursts++;
			},
		},
		sound: { play: (k) => sounds.push(k) },
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

test('a zone change follows the server and teleports to the arrival point', () => {
	const t = rig();
	t.net.zoneId = 'town';
	t.net.own = { x: 5, y: 6, hp: 20, maxHp: 20, hurtT: 0 };
	t.run(1);
	expect(t.loop.currentZone.id).toBe('town');
	expect(t.loop.avatar.x).toBe(5);
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

test('a level-up plays the cue, bursts particles, and flashes the HUD — exactly once', () => {
	const t = rig();
	t.net.latest = { progress: { level: 1, xp: 0, gold: 0 } };
	t.run(2); // first snapshot seeds prevLevel without firing
	expect(t.bursts).toBe(0);

	t.net.latest = { progress: { level: 2, xp: 0, gold: 0 } };
	t.run(1);
	expect(t.bursts).toBe(1);
	expect(t.sounds).toContain('level-up');
	expect(t.sounds).toContain('flash');

	t.run(3);
	expect(t.bursts).toBe(1);
});

test('a first snapshot at a high level cannot false-trigger a level-up', () => {
	const t = rig();
	t.net.latest = { progress: { level: 12, xp: 0, gold: 0 } };
	t.run(3);
	expect(t.bursts).toBe(0);
});

test('a swing emits predicted CombatEvents into the playfield', () => {
	const t = rig();
	t.input = { ...IDLE, attack: true };
	t.run(20);
	expect(t.emitted.length).toBeGreaterThan(0);
});

test('every frame hands a fresh game state to the playfield and the HUD', () => {
	const t = rig();
	t.run(3);
	expect(t.games).toHaveLength(3);
	expect(t.syncs).toBe(3);
	// Absent a snapshot the fused state carries the predicted Avatar itself, not a copy.
	expect(t.games[2].player.avatar).toBe(t.loop.avatar);
});

test('emote stamps the predicted Avatar so the sender sees it immediately', () => {
	const t = rig();
	t.loop.emote(EMOTES[0].id);
	expect(t.loop.avatar.emoteId).toBe(EMOTES[0].id);
});
