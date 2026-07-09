// Pure compiler from a parsed `.sprite` document frame (see `sprite-file.ts`)
// to a runtime `Sprite` (see `sprite.ts`).
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
