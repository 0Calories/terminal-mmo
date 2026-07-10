import { watch } from 'node:fs';
import { loadCatalogs, loadZone } from '@mmo/assets';
import type { Zone } from '@mmo/core';
import {
	buildSceneStyle,
	drawNameplates,
	renderZoneScene,
	type ZoneScene,
} from '@mmo/render';
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';

export interface Cam {
	x: number;
	y: number;
}

export function clampPreviewCam(
	cam: Cam,
	gridW: number,
	gridH: number,
	viewW: number,
	viewH: number,
): Cam {
	return {
		x: Math.max(0, Math.min(cam.x, Math.max(0, gridW - viewW))),
		y: Math.max(0, Math.min(cam.y, Math.max(0, gridH - viewH))),
	};
}

export function sceneOf(zone: Zone): ZoneScene {
	return {
		terrain: zone.terrain,
		portals: zone.portals,
		npcs: zone.npcs ?? [],
		entities: zone.monsters,
	};
}

export function statusLine(zone: Zone): string {
	return `zone ${zone.id}  ${zone.terrain.w}x${zone.terrain.h}  arrows/hjkl pan · q quit`;
}

const PAN_STEP = 4;

export async function runPreview(args: string[], deps: CliDeps): Promise<void> {
	const id = args[0];
	if (!id) {
		deps.log('preview: missing <id>');
		process.exitCode = 1;
		return;
	}

	const catalogs = loadCatalogs(deps.root);
	const first = loadZone(deps.root, id, catalogs);
	if (!first.zone) {
		deps.log(`preview: cannot load '${id}': ${first.parseError}`);
		process.exitCode = 1;
		return;
	}

	const { createCliRenderer, Renderable, RGBA } = await import('@opentui/core');
	const style = buildSceneStyle((r, g, b, a) => RGBA.fromInts(r, g, b, a));
	let scene = sceneOf(first.zone);
	let status = statusLine(first.zone);
	const cam: Cam = { x: 0, y: 0 };

	class PreviewRenderable extends Renderable {
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		constructor(ctx: any) {
			super(ctx, { width: '100%', height: '100%', live: true });
		}

		protected renderSelf(buf: OptimizedBuffer): void {
			const next = clampPreviewCam(
				cam,
				scene.terrain.w,
				scene.terrain.h,
				buf.width,
				buf.height,
			);
			cam.x = next.x;
			cam.y = next.y;
			renderZoneScene(buf, scene, cam, style);
			drawNameplates(buf, scene.entities, cam, scene.terrain, style);
			for (let x = 0; x < buf.width; x++)
				buf.setCell(x, 0, ' ', style.paletteDefault, style.terrainBg);
			for (let i = 0; i < status.length && i < buf.width; i++)
				buf.setCell(i, 0, status[i], style.paletteDefault, style.terrainBg);
		}
	}

	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
	});
	renderer.root.add(new PreviewRenderable(renderer));

	renderer.keyInput.on('keypress', (k: { name: string }) => {
		switch (k.name) {
			case 'left':
			case 'h':
				cam.x -= PAN_STEP;
				break;
			case 'right':
			case 'l':
				cam.x += PAN_STEP;
				break;
			case 'up':
			case 'k':
				cam.y -= PAN_STEP;
				break;
			case 'down':
			case 'j':
				cam.y += PAN_STEP;
				break;
			case 'q':
				(renderer as unknown as { destroy?: () => void }).destroy?.();
				process.exit(0);
		}
	});

	// Watch the dir, not the file: atomic rename saves break a direct file watch.
	watch(deps.root, (_event, fname) => {
		if (fname && fname !== `${id}.zone`) return;
		const next = loadZone(deps.root, id, catalogs);
		if (next.zone) {
			scene = sceneOf(next.zone);
			status = statusLine(next.zone);
		} else {
			status = `zone ${id}  — parse error: ${next.parseError}`;
		}
	});

	renderer.start();
}
