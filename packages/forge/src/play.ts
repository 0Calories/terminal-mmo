import { loadCatalogs, loadZoneSet } from '@mmo/assets';
import { BOX, type Input } from '@mmo/core/entities';
import {
	createLocalWorld,
	type LocalWorld,
	localAvatar,
	localZoneState,
	stepLocalWorld,
} from '@mmo/core/world';
import type { ZoneScene } from '@mmo/render';
import type { Compositor } from '@mmo/render/compositor';
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import { type Cam, clampPreviewCam } from './preview';
import { encodeToBuffer } from './render/compositor-encode';
import { composeZone, compositorFor } from './render/zone-compose';

export function playSceneOf(lw: LocalWorld): ZoneScene {
	const zone = mustZoneState(lw).zone;
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

export function playStatusLine(lw: LocalWorld): string {
	const z = mustZoneState(lw).zone;
	const me = mustAvatar(lw);
	const a = me.avatar;
	const p = me.progress;
	return `zone ${z.id}  hp ${Math.ceil(a.hp)}/${a.maxHp}  lv ${p.level}  gold ${p.gold}  ·  arrows/ad move · up/space jump · j attack · e portal · q quit`;
}

function mustZoneState(lw: LocalWorld) {
	const zs = localZoneState(lw);
	if (!zs) throw new Error('local session is not placed in any Zone');
	return zs;
}

function mustAvatar(lw: LocalWorld) {
	const me = localAvatar(lw);
	if (!me) throw new Error('local session has no Avatar');
	return me;
}

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
	const statusFg = RGBA.fromInts(232, 232, 238, 255);
	const statusBg = RGBA.fromInts(34, 40, 54, 255);

	let lw = createLocalWorld(zones, id);
	const input = new PlayInput();
	let compositor: Compositor | null = null;

	class PlayRenderable extends Renderable {
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		constructor(ctx: any) {
			super(ctx, { width: '100%', height: '100%', live: true });
		}

		protected renderSelf(buf: OptimizedBuffer): void {
			const a = mustAvatar(lw).avatar;
			const scene = playSceneOf(lw);
			const cam = followCam(
				a.x + BOX.w / 2,
				a.y + BOX.h / 2,
				scene.terrain.w,
				scene.terrain.h,
				buf.width,
				buf.height,
			);
			compositor = compositorFor(compositor, buf.width, buf.height);
			composeZone(compositor, scene, cam, a);
			encodeToBuffer(compositor, buf);
			const status = playStatusLine(lw);
			for (let x = 0; x < buf.width; x++)
				buf.setCell(x, 0, ' ', statusFg, statusBg);
			for (let i = 0; i < status.length && i < buf.width; i++)
				buf.setCell(i, 0, status[i], statusFg, statusBg);
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
		lw = stepLocalWorld(lw, input.poll(performance.now()), dt);
	});

	renderer.start();
}
