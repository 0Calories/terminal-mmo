// Pure compiler from a parsed `.sprite` document frame (see `sprite-file.ts`)
// to a runtime `Sprite` (see `sprite.ts`).
import type { PoseId } from '@mmo/core/sprites';
import type { BodySprite } from './body-sprite';
import { SENTINEL, Sprite } from './sprite';
import type { SpriteDoc, SpriteFrameDoc } from './sprite-file';
import { WEAPON_ACCENT_KEY, type WeaponSprite } from './weapon-sprite';

function toGlyphText(rows: readonly string[]): string {
	return rows.map((row) => row.replaceAll(' ', SENTINEL)).join('\n');
}

function isAllBlank(rows: readonly string[]): boolean {
	return rows.every((row) => Array.from(row).every((ch) => ch === ' '));
}

function toGridText(rows: readonly string[]): string | undefined {
	if (isAllBlank(rows)) return undefined;
	// Blank cells become SENTINEL (not a literal space) so a fully-transparent
	// trailing row survives Sprite's blank-line trimming — otherwise a colour/bg
	// grid whose bottom row is all-transparent would come out one row short of
	// the art grid. SENTINEL maps back to the default key (colours) / no-bg (bg).
	return rows.map((row) => row.replaceAll(' ', SENTINEL)).join('\n');
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
	// A body's baseline is a whole-form property carried on BodySprite, not on
	// each pose frame — leaving the per-frame Sprite baseline at its 0 default
	// keeps compiled frames byte-identical to hand-authored ones.
	return new Sprite(toGlyphText(frame.rows), {
		defaultKey: doc.key,
		colors: toGridText(frame.colors),
		bg: toGridText(frame.bg),
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

// Compile a weapon sprite (ADR 0031): phase poses `idle`/`windup`/`recovery`
// each compile to a single Sprite, `active` to the swing sweep (readonly
// Sprite[]) the renderer samples by Attack progress. The grip is a doc-level
// anchor (an offset, so it may be negative); the accent is the palette key the
// dynamic `a` channel resolves to at render time. Assumes the doc passed the
// `weapons` role profile — still throws if the required grip is absent.
export function compileWeaponSprite(doc: SpriteDoc): WeaponSprite {
	const grip = doc.anchors.grip;
	if (grip === undefined)
		throw new Error(
			`sprite doc '${doc.id}' (role 'weapons') requires a doc-level anchor 'grip'`,
		);

	const frames: WeaponSprite['frames'] = {};
	if (doc.poses.idle) frames.idle = spriteFromDoc(doc, doc.poses.idle[0]);
	if (doc.poses.windup) frames.windup = spriteFromDoc(doc, doc.poses.windup[0]);
	if (doc.poses.recovery)
		frames.recovery = spriteFromDoc(doc, doc.poses.recovery[0]);
	if (doc.poses.active)
		frames.active = doc.poses.active.map((name) => spriteFromDoc(doc, name));

	return {
		frames,
		grip: { x: grip.x, y: grip.y },
		accent: doc.accent ?? WEAPON_ACCENT_KEY,
	};
}
