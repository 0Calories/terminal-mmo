import {
	BOX,
	buildSceneStyle,
	createGameFromZones,
	drawEntitySprite,
	type GameState,
	type Input,
	renderZoneScene,
	step,
	type ZoneScene,
} from '@mmo/shared';
// Type-only import is erased at compile time, so it never loads opentui's
// runtime — the pure helpers below stay testable without a terminal.
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import { loadCatalogs, loadZoneSet } from './io';
import { type Cam, clampPreviewCam } from './preview';

// --- Pure helpers (unit-tested; the opentui shell below is manual per PRD) ----

/**
 * The active Zone of a running game as a renderable scene: terrain, portals,
 * NPCs, and the simulated Monsters. The Player Avatar is drawn on top by the
 * shell (ADR 0003), so it is NOT in `entities` here.
 */
export function playSceneOf(game: GameState): ZoneScene {
	const zone = game.world.zones[game.player.zoneId];
	return {
		terrain: zone.terrain,
		portals: zone.portals,
		npcs: zone.npcs ?? [],
		entities: zone.monsters,
	};
}

/**
 * Centre the camera on a world point and clamp it to the Zone grid, so the
 * followed Avatar sits near the viewport middle but blank space never scrolls
 * in past an edge. Kept as a float — the renderer rounds at draw time.
 */
export function followCam(
	cx: number,
	cy: number,
	gridW: number,
	gridH: number,
	viewW: number,
	viewH: number,
): Cam {
	return clampPreviewCam(
		{ x: cx - viewW / 2, y: cy - viewH / 2 },
		gridW,
		gridH,
		viewW,
		viewH,
	);
}

/** A one-line status header: active Zone, Player vitals, and the control hints. */
export function playStatusLine(game: GameState): string {
	const z = game.world.zones[game.player.zoneId];
	const a = game.player.avatar;
	const p = game.player.progress;
	return `zone ${z.id}  hp ${Math.ceil(a.hp)}/${a.maxHp}  lv ${p.level}  gold ${p.gold}  ·  arrows/ad move · up/space jump · j attack · e portal · q quit`;
}

// --- Interactive shell (opentui; not unit-tested, validated by eye) -----------

// Fallback timeout for terminals without Kitty key-release reporting: without
// release events a held key would stick, so it's dropped after this idle.
const HELD_MS = 220;

type Action = 'left' | 'right' | 'jump' | 'attack' | 'interact';

function actionFor(name: string): Action | null {
	switch (name) {
		case 'left':
		case 'a':
			return 'left';
		case 'right':
		case 'd':
			return 'right';
		case 'up':
		case 'space':
			return 'jump';
		case 'j':
		case 'x':
			return 'attack';
		case 'e':
			return 'interact';
		default:
			return null;
	}
}

// A minimal held-key tracker mapping the keyboard to the sim's `Input`. Distinct
// from the client's InputState (which also drives skills/chat) but the same
// view-layer glue — not physics or combat, which stay in the shared `step`.
class PlayInput {
	private held = new Set<Action>();
	private seen = new Map<Action, number>();
	private releaseCapable = false;

	press(name: string, now: number): void {
		const a = actionFor(name);
		if (!a) return;
		this.held.add(a);
		this.seen.set(a, now);
	}

	release(name: string): void {
		this.releaseCapable = true;
		const a = actionFor(name);
		if (a) this.held.delete(a);
	}

	poll(now: number): Input {
		if (!this.releaseCapable) {
			for (const a of [...this.held])
				if (now - (this.seen.get(a) ?? 0) > HELD_MS) this.held.delete(a);
		}
		const moveX =
			(this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
		return {
			moveX: moveX as -1 | 0 | 1,
			jump: this.held.has('jump'),
			attack: this.held.has('attack'),
			interact: this.held.has('interact'),
		};
	}
}

/**
 * `zone play <id>`: boot the authored Zone set into the offline single-player sim
 * and drop a controllable Avatar into `<id>` — run/jump the terrain, take portals,
 * fight the spawned Monsters — all from the `.zone` content, no game server.
 * Reuses the shared renderer (#56) and the shared `step` (no duplicate physics or
 * combat). Long-lived: opentui owns the process lifecycle (ctrl-c / q exit).
 */
export async function runPlay(args: string[], deps: CliDeps): Promise<void> {
	const id = args[0];
	if (!id) {
		deps.log('play: missing <id>');
		process.exitCode = 1;
		return;
	}

	// Load the whole set so portal travel between Zones works; a broken file is
	// skipped (with a warning) rather than aborting the playtest.
	const catalogs = loadCatalogs(deps.root);
	const loaded = loadZoneSet(deps.root, catalogs);
	for (const l of loaded)
		if (!l.zone) deps.log(`play: skipping '${l.id}': ${l.parseError}`);
	const zones = loaded.flatMap((l) => (l.zone ? [l.zone] : []));
	if (!zones.some((z) => z.id === id)) {
		const reason =
			loaded.find((l) => l.id === id)?.parseError ?? 'no such Zone';
		deps.log(`play: cannot play '${id}': ${reason}`);
		process.exitCode = 1;
		return;
	}

	const { createCliRenderer, Renderable, RGBA } = await import('@opentui/core');
	const style = buildSceneStyle((r, g, b, a) => RGBA.fromInts(r, g, b, a));
	let game = createGameFromZones(zones, id);
	const input = new PlayInput();

	class PlayRenderable extends Renderable {
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		constructor(ctx: any) {
			super(ctx, { width: '100%', height: '100%', live: true });
		}

		protected renderSelf(buf: OptimizedBuffer): void {
			const a = game.player.avatar;
			const cam = followCam(
				a.x + BOX.w / 2,
				a.y + BOX.h / 2,
				game.world.zones[game.player.zoneId].terrain.w,
				game.world.zones[game.player.zoneId].terrain.h,
				buf.width,
				buf.height,
			);
			const scene = playSceneOf(game);
			renderZoneScene(buf, scene, cam, style);
			// The local Avatar is drawn on top of the z-sorted scene (ADR 0003), planting
			// onto the same terrain renderZoneScene drew (ADR 0021).
			drawEntitySprite(buf, a, cam, style, scene.terrain);
			// Status header on row 0 (sky in most Zones), so vitals stay visible
			// without hiding terrain.
			const status = playStatusLine(game);
			for (let x = 0; x < buf.width; x++)
				buf.setCell(x, 0, ' ', style.paletteDefault, style.terrainBg);
			for (let i = 0; i < status.length && i < buf.width; i++)
				buf.setCell(i, 0, status[i], style.paletteDefault, style.terrainBg);
		}
	}

	const renderer = await createCliRenderer({
		targetFps: 60,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
		// Report RELEASE events for continuous held movement.
		useKittyKeyboard: { events: true },
	});
	renderer.root.add(new PlayRenderable(renderer));

	renderer.keyInput.on('keypress', (k: { name: string }) => {
		if (k.name === 'q') {
			(renderer as unknown as { destroy?: () => void }).destroy?.();
			process.exit(0);
		}
		input.press(k.name, performance.now());
	});
	renderer.keyInput.on('keyrelease', (k: { name: string }) =>
		input.release(k.name),
	);

	// Drive the shared offline sim each frame; the Renderable live-renders `game`.
	renderer.setFrameCallback(async (dt: number) => {
		game = step(game, input.poll(performance.now()), dt);
	});

	renderer.start();
}
