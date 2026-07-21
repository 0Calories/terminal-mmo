// Pure compiler from a parsed `.sprite` document frame (see `sprite-file.ts`)
// to a runtime `Sprite` (see `sprite.ts`).
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
	// Blank cells become SENTINEL (not a literal space) so a fully-transparent
	// trailing row survives Sprite's blank-line trimming — otherwise a colour/bg
	// grid whose bottom row is all-transparent would come out one row short of
	// the art grid. SENTINEL maps back to the default key (colours) / no-bg (bg).
	return rows.map((row) => row.replaceAll(' ', SENTINEL)).join('\n');
}

// Compile a specific frame object into a runtime Sprite carrying its effective
// anchors (doc-level anchors overlaid with the frame's own per-index overrides —
// frame wins). The baseline is a whole-form property, so per-frame Sprites keep
// the 0 default (BodySprite carries the real baseline); pass `withBaseline` for
// the standalone previews (`spriteFromDoc`) that render the frame directly.
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

// Compile a single frame — selected by its canonical label (ADR 0037), or the
// Default frame when no label is given / it does not resolve — to a runtime
// Sprite. Non-form roles (hats/monsters/npcs) call this with their sole
// animation's name as the label.
export function spriteFromDoc(doc: SpriteDoc, label?: string): Sprite {
	const resolved =
		label !== undefined ? findFrame(doc, label)?.frame : undefined;
	const frame = resolved ?? defaultFrame(doc);
	if (frame === undefined)
		throw new Error(`sprite doc '${doc.id}' has no frames`);
	return frameSprite(doc, frame, true);
}

// Compile a full-body sprite: every animation becomes a Sprite (single frame) or a
// readonly Sprite[] (>1 frame), and the per-animation fps values are gathered into
// the name→fps lookup `bodyFrame` consumes. Assumes the doc passed `forms` role
// validation; still throws (rather than emitting NaN) if the required grip/head
// anchors are absent.
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

// Compile a weapon sprite (ADR 0036/0037): the Default frame — frame 0 of the
// first animation — becomes the rest sprite, and the `swing` animation's
// exactly-three frames compile phase-indexed (windup/active/recovery). The grip
// is a doc-level anchor (an offset, so it may be negative); the accent is the
// palette key the dynamic `a` channel resolves to at render time. Assumes the
// doc passed the `weapons` role profile — still throws if the grip or the
// 3-frame swing is absent.
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
