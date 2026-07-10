// Whole-set validation for `.sprite` assets (ADR 0031). Pure functions over
// in-memory SpriteSources (no fs) returning SpriteDiagnostic[] (the same
// diagnostic shape the parser emits). Role profiles declare the poses and
// doc-level anchors a sprite of that role must provide; `validateSpriteSet` also
// enforces the whole-set joins `forge sprite check` gates in CI: dangling
// weapon/monster/npc catalog references, unresolvable color keys (the parser's
// silent-default hazard, surfaced as an error), and reserved `p`/`a` redefinition
// (aggregated from the parser). Missing requirements are `error` diagnostics.

import { EMOTES, MONSTER_SPRITE_REF, NPC_SPRITE_REF, WEAPONS } from '@mmo/core';
import type { SpriteDiagnostic, SpriteDoc } from './sprite-file';
import { parseSpriteFile } from './sprite-file';
import type { SpriteSource } from './sprite-sources';

// The emote ids the sim knows about (core's registry). A Form pose named
// `emote:<x>` is only meaningful if `<x>` is one of these.
const KNOWN_EMOTES = new Set(EMOTES.map((e) => e.id));

interface RoleProfile {
	// Poses that must exist (by name) in the doc's resolved pose map.
	poses: readonly string[];
	// Doc-level anchors that must be declared.
	anchors: readonly string[];
}

export const ROLE_PROFILES: Readonly<Record<string, RoleProfile>> = {
	forms: { poses: ['idle', 'walkA', 'walkB'], anchors: ['grip', 'head'] },
	// `recovery` is optional for weapons, so it is not required here.
	weapons: { poses: ['idle', 'windup', 'active'], anchors: ['grip'] },
	hats: { poses: ['idle'], anchors: [] },
	monsters: { poses: ['idle'], anchors: [] },
	npcs: { poses: ['idle'], anchors: [] },
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

	for (const pose of profile.poses) {
		if (!(pose in doc.poses)) {
			diagnostics.push({
				severity: 'error',
				spriteId: doc.id,
				message: `sprite '${doc.id}' (role '${role}') is missing required pose '${pose}'`,
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
	// A Form may author `emote:<x>` poses; the sim only plays emotes in core's
	// EMOTES registry, so a pose for an unregistered emote is a dead grid and an
	// authoring error. (A registered emote the Form omits is fine — it falls back
	// to idle at runtime.)
	if (role === 'forms') {
		for (const poseName of Object.keys(doc.poses)) {
			if (!poseName.startsWith('emote:')) continue;
			const emoteId = poseName.slice('emote:'.length);
			if (!KNOWN_EMOTES.has(emoteId)) {
				diagnostics.push({
					severity: 'error',
					spriteId: doc.id,
					message: `sprite '${doc.id}' (role '${role}') has pose '${poseName}' for unknown emote '${emoteId}'`,
				});
			}
		}
	}
	return diagnostics;
}

// The prefix of the parser's unknown-color-key diagnostic. The parser resolves a
// cell key against SCENE_PALETTE ∪ reserved (`p`/`a`) ∪ the file's own palette
// and, for a key in none of those, keeps the raw key but only *warns* — it does
// not silently swap in a default. Per ADR 0031 an unresolvable key is not
// acceptable art, so the set validator surfaces that warning as an error.
const UNKNOWN_COLOR_KEY_PREFIX = 'unknown color key';

// Does a sprite of the given role and id resolve in this source set? Mirrors the
// exact filtering `buildSpriteRegistry` / `buildWeaponRegistry` apply before a
// sprite lands in a role registry — parses cleanly, no error diagnostics, and
// satisfies its role profile — so a `has` here means the registry would resolve
// it. (Reimplemented from those predicates rather than calling the builders: the
// builder modules run disk-backed registry builds at module-eval time, so a
// static import of them from here forms an initialization cycle — their
// module-level `loadSpriteSources()` runs while this module's consts are still
// in TDZ.)
function resolvesInRole(
	sources: SpriteSource[],
	role: string,
	id: string,
): boolean {
	const source = sources.find((s) => s.role === role && s.id === id);
	if (source === undefined) return false;
	const { doc, diagnostics } = parseSpriteFile(source.text, source.id);
	if (doc === null) return false;
	if (diagnostics.some((d) => d.severity === 'error')) return false;
	if (validateSpriteRole(doc, role).some((d) => d.severity === 'error'))
		return false;
	return true;
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
