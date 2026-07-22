import type { AnimationId } from '@mmo/core/sprites';
import type { BodySprite } from './body-sprite';
import { SENTINEL, Sprite } from './sprite';
import {
	defaultFrame,
	findFrame,
	type SpriteDoc,
	type SpriteFrameDoc,
} from './sprite-file';
import { WEAPON_ACCENT_KEY, type WeaponSprite } from './weapon-sprite';

function toGlyphText(rows: readonly string[]): string {
	return rows.map((row) => row.replaceAll(' ', SENTINEL)).join('\n');
}

function isAllBlank(rows: readonly string[]): boolean {
	return rows.every((row) => Array.from(row).every((ch) => ch === ' '));
}

function toGridText(rows: readonly string[]): string | undefined {
	if (isAllBlank(rows)) return undefined;

	return rows.map((row) => row.replaceAll(' ', SENTINEL)).join('\n');
}

function frameSprite(
	doc: SpriteDoc,
	frame: SpriteFrameDoc,
	withBaseline: boolean,
): Sprite {
	const anchors = { ...doc.anchors, ...frame.anchors };
	return new Sprite(toGlyphText(frame.rows), {
		defaultKey: doc.key,
		colors: toGridText(frame.colors),
		bg: toGridText(frame.bg),
		...(withBaseline ? { baseline: doc.baseline } : {}),
		grip: anchors.grip,
		anchors,
	});
}

export function spriteFromDoc(doc: SpriteDoc, label?: string): Sprite {
	const resolved =
		label !== undefined ? findFrame(doc, label)?.frame : undefined;
	const frame = resolved ?? defaultFrame(doc);
	if (frame === undefined)
		throw new Error(`sprite doc '${doc.id}' has no frames`);
	return frameSprite(doc, frame, true);
}

export function compileBodySprite(doc: SpriteDoc): BodySprite {
	const grip = doc.anchors.grip;
	const head = doc.anchors.head;
	if (grip === undefined || head === undefined)
		throw new Error(
			`sprite doc '${doc.id}' (role 'forms') requires doc-level anchors 'grip' and 'head'`,
		);

	const frames: Partial<Record<AnimationId, Sprite | readonly Sprite[]>> = {};
	const fps: Record<string, number> = {};
	for (const animation of doc.animations) {
		const compiled = animation.frames.map((f) => frameSprite(doc, f, false));
		frames[animation.name as AnimationId] =
			compiled.length === 1 ? compiled[0] : compiled;
		if (animation.fps !== undefined) fps[animation.name] = animation.fps;
	}

	return {
		frames,
		grip,
		head,
		baseline: doc.baseline,
		...(Object.keys(fps).length > 0 ? { fps } : {}),
	};
}

export function compileWeaponSprite(doc: SpriteDoc): WeaponSprite {
	const grip = doc.anchors.grip;
	if (grip === undefined)
		throw new Error(
			`sprite doc '${doc.id}' (role 'weapons') requires a doc-level anchor 'grip'`,
		);
	const rest = defaultFrame(doc);
	if (rest === undefined)
		throw new Error(`sprite doc '${doc.id}' has no frames`);
	const swing = doc.animations.find((a) => a.name === 'swing');
	if (swing === undefined || swing.frames.length !== 3)
		throw new Error(
			`sprite doc '${doc.id}' (role 'weapons') requires a 'swing' animation of exactly 3 frames`,
		);
	return {
		frames: {
			rest: frameSprite(doc, rest, true),
			swing: [
				frameSprite(doc, swing.frames[0], true),
				frameSprite(doc, swing.frames[1], true),
				frameSprite(doc, swing.frames[2], true),
			],
		},
		grip,
		accent: doc.accent ?? WEAPON_ACCENT_KEY,
	};
}
