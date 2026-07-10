// Form (body) art registry (ADR 0031): Forms live as `.sprite` files under
// repo-root `sprites/forms/`, discovered by `loadSpriteSources` and compiled
// here — the exact hats.ts pattern applied to full-body sprites. A Form is
// pickable because its file exists on disk and passes the `forms` role profile;
// there is no hand-authored TS body art any more. Unlike hats, a Form is never
// absent: an unknown/dangling id falls back to the default Form.

import { DEFAULT_FORM_ID } from '@mmo/core';
import type { BodySprite } from './body-sprite';
import { Sprite } from './sprite';
import { compileBodySprite } from './sprite-compile';
import { parseSpriteFile } from './sprite-file';
import { loadSpriteSources, type SpriteSource } from './sprite-sources';
import { validateSpriteRole } from './sprite-validate';

// A guard body used only when the disk/embedded scan yields no Forms at all (a
// broken install or a bare test env with no `sprites/` tree). It is not art —
// one transparent cell keeps the renderer from crashing on a missing default.
const PLACEHOLDER_BODY: BodySprite = {
	frames: { idle: new Sprite('·', { defaultKey: 'p' }) },
	grip: { x: 0, y: 0 },
	head: { x: 0, y: 0 },
};

export function buildFormRegistry(
	sources: Iterable<SpriteSource>,
): ReadonlyMap<string, BodySprite> {
	const registry = new Map<string, BodySprite>();
	for (const source of sources) {
		if (source.role !== 'forms') continue;
		const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
		if (doc === null) continue;
		if (diagnostics.some((d) => d.severity === 'error')) continue;
		// A Form that does not satisfy the role profile (missing poses/anchors or
		// an unknown emote) is skipped rather than compiled into a broken body.
		if (validateSpriteRole(doc, 'forms').some((d) => d.severity === 'error'))
			continue;
		registry.set(source.id, compileBodySprite(doc));
	}
	return registry;
}

const registry = buildFormRegistry(loadSpriteSources().values());

export const FORM_IDS: readonly string[] = [...registry.keys()].sort();

// Resolve a cosmetic form id to its BodySprite. A dangling or unknown id (or
// `undefined`) falls back to the default Form; if even that is missing, the
// in-code placeholder guards against a render-time crash.
export function formById(id: string | undefined): BodySprite {
	return (
		(id !== undefined ? registry.get(id) : undefined) ??
		registry.get(DEFAULT_FORM_ID) ??
		PLACEHOLDER_BODY
	);
}
