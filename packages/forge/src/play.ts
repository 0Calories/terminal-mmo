import {
	BOX,
	createGameFromZones,
	type GameState,
	type Input,
	step,
} from '@mmo/core';
import {
	buildSceneStyle,
	drawEntitySprite,
	renderZoneScene,
	type ZoneScene,
} from '@mmo/render';
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import { loadCatalogs, loadZoneSet } from './io';
import { type Cam, clampPreviewCam } from './preview';

// Avatar is drawn on top by the shell, so it's not in `entities` here.
export function playSceneOf(game: GameState): ZoneScene {
	const zone = game.world.zones[game.player.zoneId];
	return {
		terrain: zone.terrain,
		portals: zone.portals,
		npcs: zone.npcs ?? [],
		entities: zone.monsters,
	};
}

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

export function playStatusLine(game: GameState): string {
	const z = game.world.zones[game.player.zoneId];
	const a = game.player.avatar;
	const p = game.player.progress;
	return `zone ${z.id}  hp ${Math.ceil(a.hp)}/${a.maxHp}  lv ${p.level}  gold ${p.gold}  ·  arrows/ad move · up/space jump · j attack · e portal · q quit`;
}

// Terminals without Kitty release events: a held key sticks, so drop it after this idle.
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

export async function runPlay(args: string[], deps: CliDeps): Promise<void> {
	const id = args[0];
	if (!id) {
		deps.log('play: missing <id>');
		process.exitCode = 1;
		return;
	}

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
			drawEntitySprite(buf, a, cam, style, scene.terrain);
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

	renderer.setFrameCallback(async (dt: number) => {
		game = step(game, input.poll(performance.now()), dt);
	});

	renderer.start();
}
