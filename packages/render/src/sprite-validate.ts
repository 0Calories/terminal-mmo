import { defaultFrameBox, type SpriteSource } from '@mmo/assets';
import { WEAPONS } from '@mmo/core/combat';
import { EMOTES } from '@mmo/core/entities';
import { SHIELDS } from '@mmo/core/items';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '@mmo/core/sprites';
import { QUADRANT_GLYPHS } from './quadrant';
import type {
	SpriteAnimationDoc,
	SpriteDiagnostic,
	SpriteDoc,
} from './sprite-file';
import { frameLabelAt, parseSpriteFile } from './sprite-file';

const KNOWN_EMOTES = new Set<string>(EMOTES.map((e) => e.id));

const QUADRANT_SET = new Set<string>(QUADRANT_GLYPHS);

interface RoleProfile {
	animations: readonly string[];

	anchors: readonly string[];

	/**
	 * Movement-capable roles assemble into an actor that translates one Pixel at
	 * a time, so every cell must be quadrant Pixel art — arbitrary Glyph stamps
	 * are rejected (ADR 0038).
	 */
	pixelOnly: boolean;

	/**
	 * Roles whose logical box derives from the Default frame (ADR 0042) keep
	 * one sizing per sprite: every frame's grid must match the Default frame's,
	 * so squash and stretch are drawn within the grid, never by resizing it.
	 */
	derivedBox?: boolean;
}

export const ROLE_PROFILES: Readonly<Record<string, RoleProfile>> = {
	forms: {
		animations: ['idle', 'walk'],
		anchors: ['grip', 'head', 'offhand'],
		pixelOnly: true,
	},
	weapons: { animations: ['swing'], anchors: ['grip'], pixelOnly: true },
	shields: { animations: ['block'], anchors: ['grip'], pixelOnly: true },
	hats: { animations: ['idle'], anchors: [], pixelOnly: true },
	monsters: {
		animations: ['idle'],
		anchors: [],
		pixelOnly: true,
		derivedBox: true,
	},
	npcs: {
		animations: ['idle'],
		anchors: [],
		pixelOnly: false,
		derivedBox: true,
	},
};

function validatePixelOnly(doc: SpriteDoc, role: string): SpriteDiagnostic[] {
	const diagnostics: SpriteDiagnostic[] = [];
	for (const animation of doc.animations) {
		animation.frames.forEach((frame, index) => {
			const label = frameLabelAt(animation, index);
			frame.rows.forEach((row, y) => {
				Array.from(row).forEach((ch, x) => {
					if (ch === ' ' || QUADRANT_SET.has(ch)) return;
					diagnostics.push({
						severity: 'error',
						spriteId: doc.id,
						frame: label,
						cell: { x, y },
						message: `sprite '${doc.id}' (role '${role}') has an arbitrary Glyph stamp '${ch}' at frame '${label}' cell (${x}, ${y}) — movement-capable roles must be quadrant Pixel art only (ADR 0038)`,
					});
				});
			});
		});
	}
	return diagnostics;
}

interface VisibleBounds {
	w: number;
	h: number;
}

function visibleBounds(rows: readonly string[]): VisibleBounds | null {
	let minX = Number.POSITIVE_INFINITY;
	let maxX = -1;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = -1;
	rows.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			if (row[x] === ' ') continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	});
	if (maxX < 0) return null;
	return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

function gridDims(rows: readonly string[]): VisibleBounds {
	return { w: rows[0]?.length ?? 0, h: rows.length };
}

/** How far past the Default frame's visible extent a frame may reach before
 *  the check calls it wild — attack lunges stretch a little, not double. */
const VISIBLE_EXTENT_SLACK = 2;

function validateDerivedBoxFrames(
	doc: SpriteDoc,
	role: string,
): SpriteDiagnostic[] {
	const diagnostics: SpriteDiagnostic[] = [];
	const defaultFrame = doc.animations[0]?.frames[0];
	if (defaultFrame === undefined) return diagnostics;
	const grid = gridDims(defaultFrame.rows);
	const visible = visibleBounds(defaultFrame.rows);

	for (const animation of doc.animations) {
		animation.frames.forEach((frame, index) => {
			if (frame === defaultFrame) return;
			const label = frameLabelAt(animation, index);
			const g = gridDims(frame.rows);
			if (g.w !== grid.w || g.h !== grid.h) {
				diagnostics.push({
					severity: 'error',
					spriteId: doc.id,
					frame: label,
					message: `sprite '${doc.id}' (role '${role}') frame '${label}' is ${g.w}x${g.h} but the Default frame's grid is ${grid.w}x${grid.h} — a derived-box sprite keeps one sizing, so draw squash/stretch within the grid instead of resizing it`,
				});
				return;
			}
			const v = visibleBounds(frame.rows);
			if (
				visible !== null &&
				v !== null &&
				(v.w > visible.w + VISIBLE_EXTENT_SLACK ||
					v.h > visible.h + VISIBLE_EXTENT_SLACK)
			) {
				diagnostics.push({
					severity: 'warning',
					spriteId: doc.id,
					frame: label,
					message: `sprite '${doc.id}' (role '${role}') frame '${label}' has visible art ${v.w}x${v.h}, wildly past the Default frame's ${visible.w}x${visible.h} the logical box derives from — the extra art will overhang the box`,
				});
			}
		});
	}
	return diagnostics;
}

export function validateSpriteRole(
	doc: SpriteDoc,
	role: string,
): SpriteDiagnostic[] {
	const diagnostics: SpriteDiagnostic[] = [];
	const profile = ROLE_PROFILES[role];
	if (profile === undefined) {
		diagnostics.push({
			severity: 'warning',
			spriteId: doc.id,
			message: `sprite '${doc.id}': unknown role '${role}' — no profile to validate against`,
		});
		return diagnostics;
	}

	const byName = new Map<string, SpriteAnimationDoc>(
		doc.animations.map((a) => [a.name, a]),
	);
	for (const animation of profile.animations) {
		if (!byName.has(animation)) {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role '${role}') is missing required animation '${animation}'`,
			});
		}
	}

	if (role === 'weapons') {
		const swing = byName.get('swing');
		if (swing !== undefined && swing.frames.length !== 3) {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role 'weapons') must author exactly 3 swing frames, one per attack phase, found ${swing.frames.length}`,
			});
		}
		if (doc.animations[0]?.name === 'swing') {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role 'weapons') must open with a rest Default frame — its first animation is the swing animation`,
			});
		}
	}

	if (role === 'shields') {
		const block = byName.get('block');
		if (
			block !== undefined &&
			block.frames.length > 1 &&
			block.fps === undefined
		) {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role 'shields') has a ${block.frames.length}-frame 'block' animation with no fps — Block is a held state, so 'block' must be static or fps-looped, never phase-indexed`,
			});
		}
		if (doc.animations[0]?.name === 'block') {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role 'shields') must open with a rest-carry Default frame — its first animation is the block animation`,
			});
		}
	}

	for (const anchor of profile.anchors) {
		if (!(anchor in doc.anchors)) {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role '${role}') is missing required anchor '${anchor}'`,
			});
		}
	}

	if (role === 'forms') {
		for (const animation of doc.animations) {
			if (!animation.name.startsWith('emote:')) continue;
			const emoteId = animation.name.slice('emote:'.length);
			if (!KNOWN_EMOTES.has(emoteId)) {
				diagnostics.push({
					severity: 'error',
					spriteId: doc.id,
					message: `sprite '${doc.id}' (role '${role}') has animation '${animation.name}' for unknown emote '${emoteId}'`,
				});
			}
		}

		if (doc.animations.length > 0 && doc.animations[0].name !== 'idle') {
			diagnostics.push({
				severity: 'warning',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role '${role}') should lead with the 'idle' animation — its Default frame is currently '${doc.animations[0].name}' frame 0`,
			});
		}
	}

	if (profile.derivedBox) {
		diagnostics.push(...validateDerivedBoxFrames(doc, role));
	}
	return diagnostics;
}

/**
 * Reject arbitrary Glyph stamps in movement-capable roles. Kept alongside the
 * dangling-reference check in {@link validateSpriteSet} rather than in
 * {@link validateSpriteRole}: it is a whole-catalog art constraint, not a
 * per-load acceptance gate.
 */
export function validatePixelOnlyArt(
	doc: SpriteDoc,
	role: string,
): SpriteDiagnostic[] {
	if (!ROLE_PROFILES[role]?.pixelOnly) return [];
	return validatePixelOnly(doc, role);
}

export function acceptSprite(
	source: SpriteSource,
	role: string,
): SpriteDoc | null {
	const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
	if (doc === null) return null;
	if (diagnostics.some((d) => d.severity === 'error')) return null;
	if (validateSpriteRole(doc, role).some((d) => d.severity === 'error')) {
		return null;
	}
	return doc;
}

const UNKNOWN_COLOR_KEY_PREFIX = 'unknown color key';

function resolvesInRole(
	sources: SpriteSource[],
	role: string,
	id: string,
): boolean {
	const source = sources.find((s) => s.role === role && s.id === id);
	if (source === undefined) return false;
	return acceptSprite(source, role) !== null;
}

function validateReferences(sources: SpriteSource[]): SpriteDiagnostic[] {
	const out: SpriteDiagnostic[] = [];

	for (const weapon of WEAPONS) {
		if (!resolvesInRole(sources, 'weapons', weapon.sprite)) {
			out.push({
				severity: 'error',
				spriteId: weapon.sprite,
				message: `weapon '${weapon.name}' references sprite '${weapon.sprite}', but no valid weapons sprite with that id resolves — the weapon would render with no art`,
			});
		}
	}
	for (const shield of SHIELDS) {
		if (!resolvesInRole(sources, 'shields', shield.sprite)) {
			out.push({
				severity: 'error',
				spriteId: shield.sprite,
				message: `shield '${shield.name}' references sprite '${shield.sprite}', but no valid shields sprite with that id resolves — the shield would render with no art`,
			});
		}
	}
	for (const [type, id] of Object.entries(MONSTER_SPRITE_REF)) {
		if (!resolvesInRole(sources, 'monsters', id)) {
			out.push({
				severity: 'error',
				spriteId: id,
				message: `monster type '${type}' references sprite '${id}', but no valid monsters sprite with that id resolves — the monster would render as a placeholder`,
			});
		}
	}
	for (const [kind, id] of Object.entries(NPC_SPRITE_REF)) {
		if (!resolvesInRole(sources, 'npcs', id)) {
			out.push({
				severity: 'error',
				spriteId: id,
				message: `npc kind '${kind}' references sprite '${id}', but no valid npcs sprite with that id resolves — the NPC would render as a placeholder`,
			});
		}
	}
	return out;
}

export function validateSpriteSet(
	sources: Iterable<SpriteSource>,
): SpriteDiagnostic[] {
	const list = [...sources];
	const diagnostics: SpriteDiagnostic[] = [];
	for (const source of list) {
		const { doc, diagnostics: parseDiags } = parseSpriteFile(
			source.text,
			source.id,
		);
		for (const d of parseDiags) {
			if (
				d.severity === 'warning' &&
				d.message.startsWith(UNKNOWN_COLOR_KEY_PREFIX)
			) {
				diagnostics.push({ ...d, severity: 'error' });
			} else {
				diagnostics.push(d);
			}
		}

		if (doc === null) continue;
		diagnostics.push(...validateSpriteRole(doc, source.role));
		diagnostics.push(...validatePixelOnlyArt(doc, source.role));
		diagnostics.push(...validateDerivationParity(source, doc));
	}

	diagnostics.push(...validateReferences(list));
	return diagnostics;
}

/**
 * The runtime derives a monster's logical box from the raw sprite text in
 * assets, without this parser; prove here that both derivations see the same
 * Default frame, so the box the sim uses is the box the art parser would
 * report.
 */
function validateDerivationParity(
	source: SpriteSource,
	doc: SpriteDoc,
): SpriteDiagnostic[] {
	if (!ROLE_PROFILES[source.role]?.derivedBox) return [];
	const derived = defaultFrameBox(source.text);
	const frame = doc.animations[0]?.frames[0];
	const parsed = frame === undefined ? null : visibleBounds(frame.rows);
	if (derived?.w === parsed?.w && derived?.h === parsed?.h) return [];
	const show = (b: { w: number; h: number } | null | undefined) =>
		b ? `${b.w}x${b.h}` : 'none';
	return [
		{
			severity: 'error',
			spriteId: doc.id,
			message: `sprite '${doc.id}' (role '${source.role}'): the asset-load box derivation sees ${show(derived)} where the parser sees ${show(parsed)} for the Default frame — the sim and the art disagree about this sprite's logical box`,
		},
	];
}
