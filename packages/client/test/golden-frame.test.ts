import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CombatEvent, combatEventAt, deathEvent } from '@mmo/core/combat';
import type { GameState } from '@mmo/core/protocol';
import { createTestRenderer } from '@opentui/core/testing';
import { PlayfieldRenderable } from '../src/render/playfield';
import { GOLDEN_VIEW, goldenGame, manualClock, seededRng } from './helpers';

// The baseline every client-modularization phase diffs against: a refactor that changes this
// frame changed what players see. Regenerate deliberately with `MMO_UPDATE_GOLDEN=1 bun test`.
const GOLDEN_PATH = join(import.meta.dir, 'golden', 'playfield.txt');
const SEED = 0xc0ffee;
const FRAME_MS = 16;

// The impact of the scripted `break` triggers a hitstop, and a frozen frame draws nothing.
const HITSTOP_FRAMES = 5;

// Render frames outrun snapshots, so `tick` only moves when a new snapshot lands.
interface FrameOpts {
	events?: CombatEvent[];
	tick?: number;
	zoneId?: string;
}

// Every kind of CombatEvent at once: blood + gore + impact particles, a camera kick and a hitstop.
function scriptedEvents(game: GameState): CombatEvent[] {
	const [a, b] = game.world.zones.town.monsters;
	return [
		combatEventAt('hit', a, 1, 7),
		combatEventAt('break', b, -1, 5),
		deathEvent(b),
	];
}

async function mountPlayfield() {
	const t = await createTestRenderer(GOLDEN_VIEW);
	const clock = manualClock(FRAME_MS);
	const playfield = new PlayfieldRenderable(t.renderer, {
		now: clock.now,
		rng: seededRng(SEED),
	});
	t.renderer.root.add(playfield);
	const game = goldenGame();
	playfield.game = game;

	const frame = async ({ events = [], tick, zoneId }: FrameOpts = {}) => {
		if (tick !== undefined) game.world.tick = tick;
		if (zoneId) game.player.zoneId = zoneId;
		game.events = events;
		await t.renderOnce();
		clock.tick();
	};

	const frames = async (n: number, opts?: FrameOpts) => {
		for (let i = 0; i < n; i++) await frame(opts);
	};

	return { ...t, playfield, game, frame, frames };
}

/** Renders the scripted scene and returns the settled char frame. */
async function renderGoldenFrame(): Promise<string> {
	const { frame, frames, game, captureCharFrame } = await mountPlayfield();

	await frame({ tick: 1 });
	await frame({ tick: 2, events: scriptedEvents(game) });
	// Long enough for the hitstop to lapse and the surviving specks to fly and settle.
	await frames(14);

	return captureCharFrame();
}

test('the seeded playfield renders the committed golden frame byte-for-byte', async () => {
	const frame = await renderGoldenFrame();

	if (process.env.MMO_UPDATE_GOLDEN) writeFileSync(GOLDEN_PATH, frame);
	expect(frame).toBe(readFileSync(GOLDEN_PATH, 'utf8'));
});

test('the golden frame is reproducible: the same seed and clock render it twice', async () => {
	expect(await renderGoldenFrame()).toBe(await renderGoldenFrame());
});

test('the scripted effects are visible — a quiet scene renders a different frame', async () => {
	const quiet = await mountPlayfield();
	await quiet.frames(16);

	expect(await renderGoldenFrame()).not.toBe(quiet.captureCharFrame());
});

test('a re-sent snapshot spawns its effects once, not once per frame', async () => {
	const { frame, frames, game, captureCharFrame } = await mountPlayfield();
	const events = scriptedEvents(game);

	await frame({ tick: 1 });
	await frame({ tick: 2, events });
	// The repeat must land after the hitstop, or the frozen frame swallows it before the gate.
	await frames(HITSTOP_FRAMES);
	await frame({ events });
	await frames(8);

	expect(captureCharFrame()).toBe(await renderGoldenFrame());
});

test('a zone change clears carried-over particles: old-zone specks never render in the new zone (#373)', async () => {
	// The same arrival with and without a burst back in town must render the
	// same dungeon frame once the kick has drained — town's specks (alive for
	// seconds otherwise) may not follow the player through the door.
	const arrive = async (townEvents: boolean) => {
		const { frame, frames, game, captureCharFrame } = await mountPlayfield();
		await frame({ tick: 1 });
		await frame({ tick: 2, events: townEvents ? scriptedEvents(game) : [] });
		await frames(HITSTOP_FRAMES);
		await frame({ tick: 3, zoneId: 'dungeon' });
		await frames(12);
		return captureCharFrame();
	};

	expect(await arrive(true)).toBe(await arrive(false));
});

test('a zone change resets the gate, so entry effects fire even on a colliding tick', async () => {
	const enter = async (events: CombatEvent[]) => {
		const { frame, frames, game, captureCharFrame } = await mountPlayfield();
		await frame({ tick: 1 });
		await frame({ tick: 2, events: scriptedEvents(game) });
		await frames(HITSTOP_FRAMES);
		// The dungeon's first snapshot reuses tick 2; without the reset its effects are swallowed.
		await frame({ events, zoneId: 'dungeon' });
		await frames(8);
		return captureCharFrame();
	};

	const arrival = scriptedEvents(goldenGame());
	expect(await enter(arrival)).not.toBe(await enter([]));
});
