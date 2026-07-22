import { describe, expect, test } from 'bun:test';
import {
	type AssetInventory,
	backspaceQuery,
	beginNewSprite,
	cancelNewSprite,
	commitNewSprite,
	currentEntry,
	moveCursor,
	newSpriteBackspaceId,
	newSpriteChooseRole,
	newSpriteError,
	newSpriteMoveRole,
	newSpriteRole,
	newSpriteTypeId,
	openPicker,
	type PickerState,
	pickerLaunch,
	pickerSections,
	typeQuery,
	visibleEntries,
} from '../src/picker/model';

function query(state: PickerState, str: string): PickerState {
	let s = state;
	for (const ch of str) s = typeQuery(s, ch);
	return s;
}

function inventory(): AssetInventory {
	return {
		sprites: [
			{ role: 'hat', id: 'straw' },
			{ role: 'form', id: 'buddy' },
			{ role: 'hat', id: 'cap' },
			{ role: 'weapon', id: 'sword' },
			{ role: 'form', id: 'archer' },
		],
		zones: [{ id: 'town-01' }, { id: 'field-01' }],
	};
}

describe('grouping into sections', () => {
	test('sprites group by role in rail order, then a zones section, ids sorted', () => {
		const secs = pickerSections(openPicker(inventory()));
		expect(secs.map((s) => s.label)).toEqual([
			'forms',
			'weapons',
			'hats',
			'zones',
		]);
		const forms = secs[0];
		expect(forms.kind).toBe('sprite');
		expect(forms.role).toBe('form');
		expect(forms.entries.map((e) => (e.kind === 'sprite' ? e.id : ''))).toEqual(
			['archer', 'buddy'],
		);
		const zones = secs[secs.length - 1];
		expect(zones.kind).toBe('zone');
		expect(zones.entries.map((e) => (e.kind === 'zone' ? e.id : ''))).toEqual([
			'field-01',
			'town-01',
		]);
	});

	test('empty roles produce no section', () => {
		const secs = pickerSections(openPicker(inventory()));
		expect(secs.some((s) => s.label === 'monsters')).toBe(false);
		expect(secs.some((s) => s.label === 'npcs')).toBe(false);
	});

	test('section startIndex points at the entry in the visible list', () => {
		const state = openPicker(inventory());
		const secs = pickerSections(state);
		const visible = visibleEntries(state);
		for (const sec of secs)
			expect(visible[sec.startIndex]).toEqual(sec.entries[0]);
	});
});

describe('typeahead filtering', () => {
	test('filters by substring across sections', () => {
		const state = query(openPicker(inventory()), 'a');
		const ids = visibleEntries(state).map((e) => e.id);

		expect(ids.sort()).toEqual(['archer', 'cap', 'straw', 'sword']);
	});

	test('matches the role directory too, so "hat" surfaces every hat', () => {
		const state = query(openPicker(inventory()), 'hat');
		const secs = pickerSections(state);
		expect(secs.map((s) => s.label)).toEqual(['hats']);
		expect(secs[0].entries.map((e) => e.id).sort()).toEqual(['cap', 'straw']);
	});

	test('a filtered-out section drops its header', () => {
		const state = query(openPicker(inventory()), 'sword');
		expect(pickerSections(state).map((s) => s.label)).toEqual(['weapons']);
	});

	test('backspace restores entries and is a no-op on an empty query', () => {
		let state = query(openPicker(inventory()), 'z');
		expect(visibleEntries(state).length).toBeLessThan(
			visibleEntries(openPicker(inventory())).length,
		);
		state = backspaceQuery(state);
		expect(state.query).toBe('');
		expect(backspaceQuery(state).query).toBe('');
	});

	test('typing resets the cursor to the top of the results', () => {
		const state = moveCursor(openPicker(inventory()), 5);
		expect(query(state, 's').cursor).toBe(0);
	});
});

describe('cursor movement across sections', () => {
	test('moves down through the flat visible list, clamped at the ends', () => {
		const state = openPicker(inventory());
		const n = visibleEntries(state).length;
		expect(state.cursor).toBe(0);

		const forms = pickerSections(state)[0].entries.length;
		const atFirstWeapon = moveCursor(state, forms);
		expect(currentEntry(atFirstWeapon)).toEqual({
			kind: 'sprite',
			role: 'weapon',
			id: 'sword',
		});

		expect(moveCursor(state, n + 10).cursor).toBe(n - 1);
		expect(moveCursor(state, -3).cursor).toBe(0);
	});
});

describe('Enter → launch target', () => {
	test('resolves the sprite under the cursor to a sprite editor target', () => {
		const state = openPicker(inventory());
		expect(pickerLaunch(state)).toEqual({
			kind: 'sprite',
			role: 'form',
			id: 'archer',
		});
	});

	test('resolves a zone to a zone editor target', () => {
		const state = query(openPicker(inventory()), 'town');
		expect(pickerLaunch(state)).toEqual({ kind: 'zone', id: 'town-01' });
	});

	test('an empty result resolves to null', () => {
		const state = query(openPicker(inventory()), 'zzzznope');
		expect(pickerLaunch(state)).toBeNull();
	});
});

describe('kind pre-filtering', () => {
	test('sprite pre-filter hides the zones section', () => {
		const secs = pickerSections(openPicker(inventory(), 'sprite'));
		expect(secs.some((s) => s.kind === 'zone')).toBe(false);
		expect(secs.every((s) => s.kind === 'sprite')).toBe(true);
	});

	test('zone pre-filter shows only zones', () => {
		const secs = pickerSections(openPicker(inventory(), 'zone'));
		expect(secs.map((s) => s.label)).toEqual(['zones']);
	});
});

describe('new-sprite flow (`n`)', () => {
	test('begins on the role phase and cycles roles (wrapping)', () => {
		let state = beginNewSprite(openPicker(inventory()));
		expect(state.newSprite?.phase).toBe('role');
		expect(newSpriteRole(state)).toBe('form');
		state = newSpriteMoveRole(state, -1);
		expect(newSpriteRole(state)).toBe('npc');
		state = newSpriteMoveRole(state, 1);
		expect(newSpriteRole(state)).toBe('form');
	});

	test('choosing a role advances to id entry; typing builds the id', () => {
		let state = beginNewSprite(openPicker(inventory()));
		state = newSpriteMoveRole(state, 2);
		state = newSpriteChooseRole(state);
		expect(state.newSprite?.phase).toBe('id');
		for (const ch of 'fedora') state = newSpriteTypeId(state, ch);
		expect(state.newSprite?.id).toBe('fedora');
		state = newSpriteBackspaceId(state);
		expect(state.newSprite?.id).toBe('fedor');
	});

	test('rejects illegal id chars, keeps letters/digits/-/_', () => {
		let state = newSpriteChooseRole(beginNewSprite(openPicker(inventory())));
		for (const ch of 'a b/c.d-1') state = newSpriteTypeId(state, ch);
		expect(state.newSprite?.id).toBe('abcd-1');
	});

	test('a fresh id commits to a template target (file that does not exist yet)', () => {
		let state = beginNewSprite(openPicker(inventory()));
		state = newSpriteMoveRole(state, 2);
		state = newSpriteChooseRole(state);
		for (const ch of 'newhat') state = newSpriteTypeId(state, ch);
		expect(newSpriteError(state)).toBeNull();
		expect(commitNewSprite(state)).toEqual({
			kind: 'sprite',
			role: 'hat',
			id: 'newhat',
		});
	});

	test('a colliding id errors and refuses to commit', () => {
		let state = beginNewSprite(openPicker(inventory()));
		state = newSpriteMoveRole(state, 2);
		state = newSpriteChooseRole(state);
		for (const ch of 'cap') state = newSpriteTypeId(state, ch);
		expect(newSpriteError(state)).toContain('already exists');
		expect(commitNewSprite(state)).toBeNull();
	});

	test('a blank id neither errors nor commits', () => {
		const state = newSpriteChooseRole(beginNewSprite(openPicker(inventory())));
		expect(newSpriteError(state)).toBeNull();
		expect(commitNewSprite(state)).toBeNull();
	});

	test('the zone-only picker refuses new-sprite (never creates zones)', () => {
		const state = beginNewSprite(openPicker(inventory(), 'zone'));
		expect(state.newSprite).toBeNull();
	});

	test('cancel returns to browsing', () => {
		const state = cancelNewSprite(beginNewSprite(openPicker(inventory())));
		expect(state.newSprite).toBeNull();
	});
});
