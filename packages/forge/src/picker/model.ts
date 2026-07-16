// The unified asset picker's pure list model (spec #387, issue #403). This is
// the first genuinely shared forge component: an asset-generic list over every
// editable asset — Sprite files grouped by Sprite role, Zones as their own
// section — that resolves a launch target for the matching editor. No I/O and
// no `@opentui/core` live here; the shell (`tui.ts`) reads the inventory off
// disk, renders this state, feeds keys through the reducers, and dispatches the
// resolved target to the sprite or zone editor. Everything is a deterministic
// function over `PickerState`, so grouping/filtering/cursor/new-sprite are all
// unit-testable headlessly (the pattern the editor's pure modules follow).

import type { SpriteRole } from '../sprite-editor/templates';
import { dirForRole } from '../sprite-editor/view';

// The two asset kinds the picker lists. Bare `forge` shows both; a pre-filter
// (`forge sprite edit` / `forge zone edit` with no target) narrows to one.
export type AssetKind = 'sprite' | 'zone';

// The Sprite roles the picker groups by, in rail/on-disk order (spec #387).
// New-sprite role choice cycles this list.
export const PICKER_ROLES: readonly SpriteRole[] = [
	'form',
	'weapon',
	'hat',
	'monster',
	'npc',
];

export interface SpriteAsset {
	readonly role: SpriteRole;
	readonly id: string;
}
export interface ZoneAsset {
	readonly id: string;
}

// The editable assets on disk, already resolved to roles/ids by the shell (the
// model never touches the filesystem).
export interface AssetInventory {
	readonly sprites: readonly SpriteAsset[];
	readonly zones: readonly ZoneAsset[];
}

// One selectable row — a Sprite file (role + id) or a Zone (id).
export type PickerEntry =
	| { readonly kind: 'sprite'; readonly role: SpriteRole; readonly id: string }
	| { readonly kind: 'zone'; readonly id: string };

// What Enter resolves to: the editor UI to launch and its target. Identical
// shape to PickerEntry today, but kept distinct so the launch contract can
// evolve without disturbing the list rows.
export type LaunchTarget =
	| { readonly kind: 'sprite'; readonly role: SpriteRole; readonly id: string }
	| { readonly kind: 'zone'; readonly id: string };

// The `n` new-sprite sub-flow: pick a role, then type an id (spec #387). Zone
// creation is out of scope — the picker never creates zones.
export interface NewSpriteState {
	readonly phase: 'role' | 'id';
	readonly roleIndex: number; // into PICKER_ROLES
	readonly id: string;
}

export interface PickerState {
	readonly inventory: AssetInventory;
	// A pre-filter to one asset kind, or null for the all-assets picker.
	readonly filterKind: AssetKind | null;
	// Typeahead query (lowercased on entry).
	readonly query: string;
	// Cursor index into `visibleEntries(state)`.
	readonly cursor: number;
	// The `n` overlay, or null when browsing.
	readonly newSprite: NewSpriteState | null;
}

// The human label for a section header. Sprite sections use the on-disk role
// directory ('forms', 'weapons', …); zones are their own 'zones' section.
export function sectionLabel(kind: AssetKind, role?: SpriteRole): string {
	return kind === 'zone' ? 'zones' : dirForRole(role as SpriteRole);
}

// The searchable text a query matches against: a sprite matches on its id or
// its role directory (so typing 'hat' surfaces every hat); a zone on its id.
function searchText(entry: PickerEntry): string {
	return entry.kind === 'sprite'
		? `${dirForRole(entry.role)}/${entry.id}`
		: entry.id;
}

// Every entry the inventory offers, in canonical order: sprites grouped by role
// (PICKER_ROLES order, ids sorted), then zones (ids sorted). Independent of the
// kind pre-filter and query — the raw ordering `visibleEntries` filters.
function allEntries(inv: AssetInventory): PickerEntry[] {
	const out: PickerEntry[] = [];
	for (const role of PICKER_ROLES) {
		const ids = inv.sprites
			.filter((s) => s.role === role)
			.map((s) => s.id)
			.sort();
		for (const id of ids) out.push({ kind: 'sprite', role, id });
	}
	const zoneIds = inv.zones.map((z) => z.id).sort();
	for (const id of zoneIds) out.push({ kind: 'zone', id });
	return out;
}

// The entries the current pre-filter + query keep, in canonical order. The
// cursor indexes into this list, so movement crosses section boundaries for
// free.
export function visibleEntries(state: PickerState): PickerEntry[] {
	const q = state.query.toLowerCase();
	return allEntries(state.inventory).filter((e) => {
		if (state.filterKind && e.kind !== state.filterKind) return false;
		if (q === '') return true;
		return searchText(e).toLowerCase().includes(q);
	});
}

// A section for rendering: a labeled contiguous run of the visible entries.
export interface PickerSection {
	readonly label: string;
	readonly kind: AssetKind;
	readonly role?: SpriteRole;
	readonly entries: readonly PickerEntry[];
	// The index (into visibleEntries) of this section's first entry, so a
	// renderer can map an entry back to the cursor.
	readonly startIndex: number;
}

// The visible entries grouped into sections for display. Empty sections are
// dropped (a query that filters out every hat hides the 'hats' header).
export function pickerSections(state: PickerState): PickerSection[] {
	const visible = visibleEntries(state);
	const sections: PickerSection[] = [];
	let i = 0;
	while (i < visible.length) {
		const first = visible[i];
		const label =
			first.kind === 'sprite'
				? sectionLabel('sprite', first.role)
				: sectionLabel('zone');
		const start = i;
		const entries: PickerEntry[] = [];
		while (i < visible.length) {
			const e = visible[i];
			const sameSection =
				first.kind === 'sprite'
					? e.kind === 'sprite' && e.role === first.role
					: e.kind === 'zone';
			if (!sameSection) break;
			entries.push(e);
			i++;
		}
		sections.push({
			label,
			kind: first.kind,
			role: first.kind === 'sprite' ? first.role : undefined,
			entries,
			startIndex: start,
		});
	}
	return sections;
}

// Open a fresh picker over the inventory, optionally pre-filtered to one kind.
export function openPicker(
	inventory: AssetInventory,
	filterKind: AssetKind | null = null,
): PickerState {
	return { inventory, filterKind, query: '', cursor: 0, newSprite: null };
}

// Clamp the cursor into the current visible range (0 when empty).
function clampCursor(state: PickerState, cursor: number): number {
	const n = visibleEntries(state).length;
	if (n === 0) return 0;
	return Math.max(0, Math.min(n - 1, cursor));
}

// Move the cursor by `delta`, clamped to the visible list (no wrap — a browse
// list holds its ends). Crosses sections naturally.
export function moveCursor(state: PickerState, delta: number): PickerState {
	return { ...state, cursor: clampCursor(state, state.cursor + delta) };
}

// Append a typeahead char and reset the cursor to the top of the new results.
export function typeQuery(state: PickerState, ch: string): PickerState {
	if (ch.length !== 1) return state;
	const next = { ...state, query: state.query + ch.toLowerCase() };
	return { ...next, cursor: clampCursor(next, 0) };
}

// Delete the last query char (a no-op on an empty query).
export function backspaceQuery(state: PickerState): PickerState {
	if (state.query === '') return state;
	const next = { ...state, query: state.query.slice(0, -1) };
	return { ...next, cursor: clampCursor(next, state.cursor) };
}

// The entry under the cursor, or null when nothing is visible.
export function currentEntry(state: PickerState): PickerEntry | null {
	const visible = visibleEntries(state);
	return visible[state.cursor] ?? null;
}

// The launch target for an entry — the editor UI to open and its target.
export function launchTarget(entry: PickerEntry): LaunchTarget {
	return entry;
}

// The launch target Enter resolves to while browsing (null when the list is
// empty). The new-sprite flow resolves through `commitNewSprite` instead.
export function pickerLaunch(state: PickerState): LaunchTarget | null {
	const entry = currentEntry(state);
	return entry ? launchTarget(entry) : null;
}

// ---------------------------------------------------------------------------
// New-sprite flow (`n`): pick a role, type an id → a fresh-template target
// ---------------------------------------------------------------------------

// Enter the new-sprite flow (spec #387). Refused in the zone-only picker — the
// picker never creates zones — so `n` there is a no-op.
export function beginNewSprite(state: PickerState): PickerState {
	if (state.filterKind === 'zone') return state;
	return { ...state, newSprite: { phase: 'role', roleIndex: 0, id: '' } };
}

// Leave the new-sprite flow, back to browsing.
export function cancelNewSprite(state: PickerState): PickerState {
	return { ...state, newSprite: null };
}

// Step the highlighted role (role phase only), wrapping the ring.
export function newSpriteMoveRole(
	state: PickerState,
	delta: number,
): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'role') return state;
	const n = PICKER_ROLES.length;
	const roleIndex = (((ns.roleIndex + delta) % n) + n) % n;
	return { ...state, newSprite: { ...ns, roleIndex } };
}

// Confirm the role and advance to typing the id.
export function newSpriteChooseRole(state: PickerState): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'role') return state;
	return { ...state, newSprite: { ...ns, phase: 'id' } };
}

// The role the new-sprite flow currently targets.
export function newSpriteRole(state: PickerState): SpriteRole | null {
	const ns = state.newSprite;
	return ns ? PICKER_ROLES[ns.roleIndex] : null;
}

// Append an id char (id phase only). Ids are filenames: letters, digits, `-`
// and `_`. Any other char is ignored so the id stays a valid stem.
const ID_CHAR = /^[A-Za-z0-9_-]$/;
export function newSpriteTypeId(state: PickerState, ch: string): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return state;
	if (ch.length !== 1 || !ID_CHAR.test(ch)) return state;
	return { ...state, newSprite: { ...ns, id: ns.id + ch } };
}

// Delete the last id char (id phase only).
export function newSpriteBackspaceId(state: PickerState): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return state;
	return { ...state, newSprite: { ...ns, id: ns.id.slice(0, -1) } };
}

// The validation message for the typed id, or null when it is empty (still
// being typed) or valid. Surfaces the collision/blank-id cases; the letters/
// digits constraint is enforced at input so an invalid char never lands.
export function newSpriteError(state: PickerState): string | null {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return null;
	const id = ns.id.trim();
	if (id === '') return null;
	const role = PICKER_ROLES[ns.roleIndex];
	const clash = state.inventory.sprites.some(
		(s) => s.role === role && s.id === id,
	);
	if (clash) return `${dirForRole(role)}/${id} already exists`;
	return null;
}

// The launch target the new-sprite flow commits to, or null when it is not
// ready (wrong phase, blank id, or a colliding id). The target's id points at a
// file that does not exist yet, so the shell's sprite-edit path builds the
// fresh per-role template — identical to `forge sprite edit <role>/<id>`.
export function commitNewSprite(state: PickerState): LaunchTarget | null {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return null;
	const id = ns.id.trim();
	if (id === '') return null;
	if (newSpriteError(state) !== null) return null;
	return { kind: 'sprite', role: PICKER_ROLES[ns.roleIndex], id };
}
