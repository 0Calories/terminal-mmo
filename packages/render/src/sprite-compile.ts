// Pure compiler from a parsed `.sprite` document frame (see `sprite-file.ts`)
// to a runtime `Sprite` (see `sprite.ts`).
import type { AnimationId } from '@mmo/core/sprites';
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
			`sprite doc '${doc.id}' animation references missing frame '${frameName}'`,
		);
	const anchors = { ...doc.anchors, ...frame.anchors };
	// A body's baseline is a whole-form property carried on BodySprite, not on
	// each animation frame — leaving the per-frame Sprite baseline at its 0 default
	// keeps compiled frames byte-identical to hand-authored ones.
	return new Sprite(toGlyphText(frame.rows), {
		defaultKey: doc.key,
		colors: toGridText(frame.colors),
		bg: toGridText(frame.bg),
		anchors,
	});
}

// Compile a full-body sprite: every animation becomes a Sprite (single frame) or a
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

	const frames: Partial<Record<AnimationId, Sprite | readonly Sprite[]>> = {};
	for (const [animationName, frameList] of Object.entries(doc.animations)) {
		const compiled = frameList.map((name) => compileFrameSprite(doc, name));
		frames[animationName as AnimationId] =
			compiled.length === 1 ? compiled[0] : compiled;
	}

	return {
		frames,
		grip,
		head,
		baseline: doc.baseline,
		...(Object.keys(doc.fps).length > 0 ? { fps: doc.fps } : {}),
	};
}

// Compile a weapon sprite (ADR 0036): the Default frame — the first frame in
// the file — becomes the rest sprite, and the `swing` animation's exactly-three
// frames compile phase-indexed (windup/active/recovery). The grip is a
// doc-level anchor (an offset, so it may be negative); the accent is the
// palette key the dynamic `a` channel resolves to at render time. Assumes the
// doc passed the `weapons` role profile — still throws if the grip or the
// 3-frame swing is absent.
export function compileWeaponSprite(doc: SpriteDoc): WeaponSprite {
	const grip = doc.anchors.grip;
	if (grip === undefined)
		throw new Error(
			`sprite doc '${doc.id}' (role 'weapons') requires a doc-level anchor 'grip'`,
		);
	const rest = doc.frames[0];
	if (rest === undefined)
		throw new Error(`sprite doc '${doc.id}' has no frames`);
	const swing = doc.animations.swing;
	if (swing === undefined || swing.length !== 3)
		throw new Error(
			`sprite doc '${doc.id}' (role 'weapons') requires a 'swing' animation of exactly 3 frames`,
		);
	return {
		frames: {
			rest: spriteFromDoc(doc, rest.name),
			swing: [
				spriteFromDoc(doc, swing[0]),
				spriteFromDoc(doc, swing[1]),
				spriteFromDoc(doc, swing[2]),
			],
		},
		grip,
		accent: doc.accent ?? WEAPON_ACCENT_KEY,
	};
}
