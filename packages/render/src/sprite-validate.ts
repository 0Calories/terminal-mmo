import type { SpriteSource } from '@mmo/assets';
import { WEAPONS } from '@mmo/core/combat';
import { EMOTES } from '@mmo/core/entities';
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
}

export const ROLE_PROFILES: Readonly<Record<string, RoleProfile>> = {
	forms: {
		animations: ['idle', 'walk'],
		anchors: ['grip', 'head'],
		pixelOnly: true,
	},
	weapons: { animations: ['swing'], anchors: ['grip'], pixelOnly: true },
	hats: { animations: ['idle'], anchors: [], pixelOnly: true },
	monsters: { animations: ['idle'], anchors: [], pixelOnly: true },
	npcs: { animations: ['idle'], anchors: [], pixelOnly: false },
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
	}

	diagnostics.push(...validateReferences(list));
	return diagnostics;
}
