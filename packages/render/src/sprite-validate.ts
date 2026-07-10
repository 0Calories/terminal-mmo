// Role-profile validation for `.sprite` assets (ADR 0031). Pure functions that
// return SpriteDiagnostic[] (the same diagnostic shape the parser emits). A
// role profile declares the poses and doc-level anchors a sprite of that role
// must provide; missing requirements are `error` diagnostics. Catalog-reference
// and emote checks belong to a later slice — this file leaves that seam open.

import { EMOTES } from '@mmo/core';
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

export function validateSpriteSet(
	sources: Iterable<SpriteSource>,
): SpriteDiagnostic[] {
	const diagnostics: SpriteDiagnostic[] = [];
	for (const source of sources) {
		const { doc, diagnostics: parseDiags } = parseSpriteFile(
			source.text,
			source.id,
		);
		diagnostics.push(...parseDiags);
		// A parse failure is reported (via parseDiags) and skips the role check.
		if (doc === null) continue;
		diagnostics.push(...validateSpriteRole(doc, source.role));
	}
	return diagnostics;
}
