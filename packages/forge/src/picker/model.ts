import type { SpriteRole } from '../sprite-editor/templates';
import { dirForRole } from '../sprite-editor/view';

export type AssetKind = 'sprite' | 'zone';

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

export interface AssetInventory {
	readonly sprites: readonly SpriteAsset[];
	readonly zones: readonly ZoneAsset[];
}

export type PickerEntry =
	| { readonly kind: 'sprite'; readonly role: SpriteRole; readonly id: string }
	| { readonly kind: 'zone'; readonly id: string };

export type LaunchTarget =
	| { readonly kind: 'sprite'; readonly role: SpriteRole; readonly id: string }
	| { readonly kind: 'zone'; readonly id: string };

export interface NewSpriteState {
	readonly phase: 'role' | 'id';
	readonly roleIndex: number;
	readonly id: string;
}

export interface PickerState {
	readonly inventory: AssetInventory;

	readonly filterKind: AssetKind | null;

	readonly query: string;

	readonly cursor: number;

	readonly newSprite: NewSpriteState | null;
}

export function sectionLabel(kind: AssetKind, role?: SpriteRole): string {
	return kind === 'zone' ? 'zones' : dirForRole(role as SpriteRole);
}

function searchText(entry: PickerEntry): string {
	return entry.kind === 'sprite'
		? `${dirForRole(entry.role)}/${entry.id}`
		: entry.id;
}

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

export function visibleEntries(state: PickerState): PickerEntry[] {
	const q = state.query.toLowerCase();
	return allEntries(state.inventory).filter((e) => {
		if (state.filterKind && e.kind !== state.filterKind) return false;
		if (q === '') return true;
		return searchText(e).toLowerCase().includes(q);
	});
}

export interface PickerSection {
	readonly label: string;
	readonly kind: AssetKind;
	readonly role?: SpriteRole;
	readonly entries: readonly PickerEntry[];

	readonly startIndex: number;
}

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

export function openPicker(
	inventory: AssetInventory,
	filterKind: AssetKind | null = null,
): PickerState {
	return { inventory, filterKind, query: '', cursor: 0, newSprite: null };
}

function clampCursor(state: PickerState, cursor: number): number {
	const n = visibleEntries(state).length;
	if (n === 0) return 0;
	return Math.max(0, Math.min(n - 1, cursor));
}

export function moveCursor(state: PickerState, delta: number): PickerState {
	return { ...state, cursor: clampCursor(state, state.cursor + delta) };
}

export function typeQuery(state: PickerState, ch: string): PickerState {
	if (ch.length !== 1) return state;
	const next = { ...state, query: state.query + ch.toLowerCase() };
	return { ...next, cursor: clampCursor(next, 0) };
}

export function backspaceQuery(state: PickerState): PickerState {
	if (state.query === '') return state;
	const next = { ...state, query: state.query.slice(0, -1) };
	return { ...next, cursor: clampCursor(next, state.cursor) };
}

export function currentEntry(state: PickerState): PickerEntry | null {
	const visible = visibleEntries(state);
	return visible[state.cursor] ?? null;
}

export function launchTarget(entry: PickerEntry): LaunchTarget {
	return entry;
}

export function pickerLaunch(state: PickerState): LaunchTarget | null {
	const entry = currentEntry(state);
	return entry ? launchTarget(entry) : null;
}

export function beginNewSprite(state: PickerState): PickerState {
	if (state.filterKind === 'zone') return state;
	return { ...state, newSprite: { phase: 'role', roleIndex: 0, id: '' } };
}

export function cancelNewSprite(state: PickerState): PickerState {
	return { ...state, newSprite: null };
}

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

export function newSpriteChooseRole(state: PickerState): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'role') return state;
	return { ...state, newSprite: { ...ns, phase: 'id' } };
}

export function newSpriteRole(state: PickerState): SpriteRole | null {
	const ns = state.newSprite;
	return ns ? PICKER_ROLES[ns.roleIndex] : null;
}

const ID_CHAR = /^[A-Za-z0-9_-]$/;
export function newSpriteTypeId(state: PickerState, ch: string): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return state;
	if (ch.length !== 1 || !ID_CHAR.test(ch)) return state;
	return { ...state, newSprite: { ...ns, id: ns.id + ch } };
}

export function newSpriteBackspaceId(state: PickerState): PickerState {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return state;
	return { ...state, newSprite: { ...ns, id: ns.id.slice(0, -1) } };
}

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

export function commitNewSprite(state: PickerState): LaunchTarget | null {
	const ns = state.newSprite;
	if (!ns || ns.phase !== 'id') return null;
	const id = ns.id.trim();
	if (id === '') return null;
	if (newSpriteError(state) !== null) return null;
	return { kind: 'sprite', role: PICKER_ROLES[ns.roleIndex], id };
}
