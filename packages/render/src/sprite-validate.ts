// Whole-set validation for `.sprite` assets (ADR 0031). Pure functions over
// in-memory SpriteSources (no fs) returning SpriteDiagnostic[] (the same
// diagnostic shape the parser emits). Role profiles declare the animations and
// doc-level anchors a sprite of that role must provide; `validateSpriteSet` also
// enforces the whole-set joins `forge sprite check` gates in CI: dangling
// weapon/monster/npc catalog references, unresolvable color keys (the parser's
// silent-default hazard, surfaced as an error), and reserved `p`/`a` redefinition
// (aggregated from the parser). Missing requirements are `error` diagnostics.

import type { SpriteSource } from '@mmo/assets';
import { WEAPONS } from '@mmo/core/combat';
import { EMOTES } from '@mmo/core/entities';
import { MONSTER_SPRITE_REF, NPC_SPRITE_REF } from '@mmo/core/sprites';
import type { SpriteDiagnostic, SpriteDoc } from './sprite-file';
import { parseSpriteFile } from './sprite-file';

// The emote ids the sim knows about (core's registry). A Form animation named
// `emote:<x>` is only meaningful if `<x>` is one of these.
const KNOWN_EMOTES = new Set(EMOTES.map((e) => e.id));

interface RoleProfile {
	// Animations that must exist (by name) in the doc's resolved animation map.
	animations: readonly string[];
	// Doc-level anchors that must be declared.
	anchors: readonly string[];
}

export const ROLE_PROFILES: Readonly<Record<string, RoleProfile>> = {
	forms: { animations: ['idle', 'walkA', 'walkB'], anchors: ['grip', 'head'] },
	// `recovery` is optional for weapons, so it is not required here.
	weapons: { animations: ['idle', 'windup', 'active'], anchors: ['grip'] },
	hats: { animations: ['idle'], anchors: [] },
	monsters: { animations: ['idle'], anchors: [] },
	npcs: { animations: ['idle'], anchors: [] },
};

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

	for (const animation of profile.animations) {
		if (!(animation in doc.animations)) {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role '${role}') is missing required animation '${animation}'`,
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
	// A Form may author `emote:<x>` animations; the sim only plays emotes in core's
	// EMOTES registry, so an animation for an unregistered emote is a dead grid and an
	// authoring error. (A registered emote the Form omits is fine — it falls back
	// to idle at runtime.)
	if (role === 'forms') {
		for (const animationName of Object.keys(doc.animations)) {
			if (!animationName.startsWith('emote:')) continue;
			const emoteId = animationName.slice('emote:'.length);
			if (!KNOWN_EMOTES.has(emoteId)) {
				diagnostics.push({
					severity: 'error',
					spriteId: doc.id,
					message: `sprite '${doc.id}' (role '${role}') has animation '${animationName}' for unknown emote '${emoteId}'`,
				});
			}
		}
	}
	return diagnostics;
}

// The shared acceptance predicate every role registry builds on: parse a source,
// reject it on any parse-error diagnostic, then reject it unless it satisfies its
// role profile — returning the parsed doc when (and only when) it is art the
// registry would compile, or null otherwise. `buildFormRegistry`,
// `buildSpriteRegistry` (monsters/npcs) and `buildWeaponRegistry` all call this and
// keep only their compile step local; `resolvesInRole` below uses it too. Kept in
// this leaf module (no module-eval side effects) rather than in the builder
// modules on purpose: those run disk-backed `loadSpriteSources()` registry builds
// at module-eval time, so importing them here would form an initialization cycle.
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

// The prefix of the parser's unknown-color-key diagnostic. The parser resolves a
// cell key against SCENE_PALETTE ∪ reserved (`p`/`a`) ∪ the file's own palette
// and, for a key in none of those, keeps the raw key but only *warns* — it does
// not silently swap in a default. Per ADR 0031 an unresolvable key is not
// acceptable art, so the set validator surfaces that warning as an error.
const UNKNOWN_COLOR_KEY_PREFIX = 'unknown color key';

// Does a sprite of the given role and id resolve in this source set? Uses the same
// `acceptSprite` predicate the role registries build on, so a `true` here means the
// registry would resolve it.
function resolvesInRole(
	sources: SpriteSource[],
	role: string,
	id: string,
): boolean {
	const source = sources.find((s) => s.role === role && s.id === id);
	if (source === undefined) return false;
	return acceptSprite(source, role) !== null;
}

// Enumerate the sprite ids the game expects to resolve, and check each against
// the role-filtered set built from this very source set. A referenced id with no
// sprite of the right role would render as a placeholder / no art at runtime, so
// it is a build-blocking error. Pure: resolution reads the passed-in sources,
// never disk.
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
	// Materialize once: `sources` may be a single-use iterator, and the reference
	// check below re-scans the whole set to build role registries.
	const list = [...sources];
	const diagnostics: SpriteDiagnostic[] = [];
	for (const source of list) {
		const { doc, diagnostics: parseDiags } = parseSpriteFile(
			source.text,
			source.id,
		);
		for (const d of parseDiags) {
			// Surface an unresolvable color key (a silent-default hazard) as an error;
			// aggregate every other parser diagnostic — including reserved `p`/`a`
			// redefinition, already a parser error — verbatim.
			if (
				d.severity === 'warning' &&
				d.message.startsWith(UNKNOWN_COLOR_KEY_PREFIX)
			) {
				diagnostics.push({ ...d, severity: 'error' });
			} else {
				diagnostics.push(d);
			}
		}
		// A parse failure is reported (via parseDiags) and skips the role check.
		if (doc === null) continue;
		diagnostics.push(...validateSpriteRole(doc, source.role));
	}
	// Whole-set join: every catalog/reference id must resolve in this source set.
	diagnostics.push(...validateReferences(list));
	return diagnostics;
}
