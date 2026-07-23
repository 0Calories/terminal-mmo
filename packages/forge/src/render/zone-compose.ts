import type { Entity } from '@mmo/core/entities';
import type { ZoneScene } from '@mmo/render';
import { Compositor } from '@mmo/render/compositor';
import {
	drawNameplates,
	drawPortals,
	drawTerrain,
	sortActorsByDepth,
} from '@mmo/render/scene';
import {
	actorDepthY,
	npcDepthY,
	paintActor,
	paintNpc,
} from '@mmo/render/sprites';

/**
 * Compose a static Zone scene into the shared sub-cell {@link Compositor} using
 * the same production passes as the live client (ADR 0038): Terrain, Portals,
 * then the NPC/Monster crowd sorted by logical foot depth, an optional local
 * Avatar on top, and identity nameplates. Forge preview and playtest encode this
 * surface to OpenTUI, so authored zones cannot disagree with the live renderer.
 */
export function composeZone(
	compositor: Compositor,
	scene: ZoneScene,
	cam: { x: number; y: number },
	avatar?: Entity,
): void {
	compositor.clear();
	drawTerrain(compositor, scene.terrain, cam);
	drawPortals(compositor, scene.portals, cam);

	const crowd = sortActorsByDepth([
		...scene.npcs.map((n) => ({
			footY: npcDepthY(n),
			category: 'npc' as const,
			id: n.id,
			paint: () => paintNpc(compositor, n, cam),
		})),
		...scene.entities.map((m) => ({
			footY: actorDepthY(m),
			category: 'monster' as const,
			id: m.id,
			paint: () => paintActor(compositor, m, cam),
		})),
	]);
	for (const actor of crowd) actor.paint();

	if (avatar) paintActor(compositor, avatar, cam);

	drawNameplates(compositor, scene.entities, cam);
}

/** Build or resize a cached compositor to match the current viewport. */
export function compositorFor(
	current: Compositor | null,
	width: number,
	height: number,
): Compositor {
	const w = Math.max(1, width);
	const h = Math.max(1, height);
	if (current && current.widthCells === w && current.heightCells === h)
		return current;
	return new Compositor(w, h);
}
