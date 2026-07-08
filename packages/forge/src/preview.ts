import { watch } from 'node:fs';
import {
	buildSceneStyle,
	drawNameplates,
	renderZoneScene,
	type Zone,
	type ZoneScene,
} from '@mmo/shared';
// Type-only import is erased at compile time, so it never loads opentui's
// runtime — the pure helpers above stay testable without a terminal.
import type { OptimizedBuffer } from '@opentui/core';
import type { CliDeps } from './cli';
import { loadCatalogs, loadZone } from './io';

// --- Pure helpers (unit-tested; the opentui shell below is manual per PRD) ----

export interface Cam {
	x: number;
	y: number;
}

/**
 * Clamp the pan camera so it can't scroll past the grid: caps at `gridDim - view`
 * (0 when the grid is smaller than the viewport), so blank space never scrolls in.
 */
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

/**
 * The static (no avatar, no sim) scene for a parsed Zone — the same `ZoneScene` the
 * game feeds the shared renderer, so the preview is faithful (#56).
 */
export function sceneOf(zone: Zone): ZoneScene {
	return {
		terrain: zone.terrain,
		portals: zone.portals,
		npcs: zone.npcs ?? [],
		entities: zone.monsters,
	};
}

/** A one-line status header: id, dimensions, and the pan/quit key hints. */
export function statusLine(zone: Zone): string {
	return `zone ${zone.id}  ${zone.terrain.w}x${zone.terrain.h}  arrows/hjkl pan · q quit`;
}

// --- Interactive shell (opentui; not unit-tested, validated by eye) -----------

const PAN_STEP = 4;

/**
 * `zone preview <id>`: mount the shared renderer over a parsed Zone, pan with the
 * arrows / hjkl, re-render on save. Long-lived — opentui owns the lifecycle (ctrl-c / q).
 */
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
			// Names are a caller-composited top layer now (ADR 0023): the preview runs the
			// pass right after the scene so authored named entities still render, on top.
			drawNameplates(buf, scene.entities, cam, scene.terrain, style);
			// Status header on row 0 (sky in most Zones), so it doesn't hide terrain.
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

	// Watch the dir (not the file): editors save atomically via rename, which
	// breaks a direct file watch once the inode changes. Re-parse on each event;
	// a failed parse keeps the last good scene and surfaces the error in the bar.
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
