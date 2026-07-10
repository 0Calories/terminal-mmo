// Pure compiler from a parsed `.sprite` document frame (see `sprite-file.ts`)
// to a runtime `Sprite` (see `sprite.ts`).
import type { PoseId } from '@mmo/core';
import type { BodySprite } from './body-sprite';
import { SENTINEL, Sprite } from './sprite';
import type { SpriteDoc, SpriteFrameDoc } from './sprite-file';

function toGlyphText(rows: readonly string[]): string {
	return rows.map((row) => row.replaceAll(' ', SENTINEL)).join('\n');
}

function isAllBlank(rows: readonly string[]): boolean {
	return rows.every((row) => Array.from(row).every((ch) => ch === ' '));
}

function toGridText(rows: readonly string[]): string | undefined {
	if (isAllBlank(rows)) return undefined;
	return rows.join('\n');
}

function selectFrame(doc: SpriteDoc, frameName: string): SpriteFrameDoc {
	const frame = doc.frames.find((f) => f.name === frameName);
	if (frame !== undefined) return frame;
	if (doc.frames.length === 0) {
		throw new Error(`sprite doc '${doc.id}' has no frames`);
	}
	return doc.frames[0];
}

export function spriteFromDoc(doc: SpriteDoc, frameName = 'idle'): Sprite {
	const frame = selectFrame(doc, frameName);

	const grip = frame.anchors.grip ?? doc.anchors.grip;

	return new Sprite(toGlyphText(frame.rows), {
		defaultKey: doc.key,
		colors: toGridText(frame.colors),
		bg: toGridText(frame.bg),
		baseline: doc.baseline,
		grip,
	});
}

// Compile one frame into a runtime Sprite carrying its effective anchors
// (doc-level anchors overlaid with the frame's own overrides — frame wins).
function compileFrameSprite(doc: SpriteDoc, frameName: string): Sprite {
	const frame = doc.frames.find((f) => f.name === frameName);
	if (frame === undefined)
		throw new Error(
			`sprite doc '${doc.id}' pose references missing frame '${frameName}'`,
		);
	const anchors = { ...doc.anchors, ...frame.anchors };
	return new Sprite(toGlyphText(frame.rows), {
		defaultKey: doc.key,
		colors: toGridText(frame.colors),
		bg: toGridText(frame.bg),
		baseline: doc.baseline,
		anchors,
	});
}

// Compile a full-body sprite: every pose becomes a Sprite (single frame) or a
// readonly Sprite[] (>1 frame). Assumes the doc passed `forms` role validation;
// still throws (rather than emitting NaN) if the required grip/head anchors are
// absent. `fps` is carried through for a later animation slice to consume.
export function compileBodySprite(doc: SpriteDoc): BodySprite {
	const grip = doc.anchors.grip;
	const head = doc.anchors.head;
	if (grip === undefined || head === undefined)
		throw new Error(
			`sprite doc '${doc.id}' (role 'forms') requires doc-level anchors 'grip' and 'head'`,
		);

	const frames: Partial<Record<PoseId, Sprite | readonly Sprite[]>> = {};
	for (const [poseName, frameList] of Object.entries(doc.poses)) {
		const compiled = frameList.map((name) => compileFrameSprite(doc, name));
		frames[poseName as PoseId] = compiled.length === 1 ? compiled[0] : compiled;
	}

	return {
		frames,
		grip,
		head,
		baseline: doc.baseline,
		...(Object.keys(doc.fps).length > 0 ? { fps: doc.fps } : {}),
	};
}
