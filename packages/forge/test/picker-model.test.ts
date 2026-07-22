import { describe, expect, test } from 'bun:test';
import {
	type AssetInventory,
	beginNewSprite,
	commitNewSprite,
	moveCursor,
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
import type { SpriteRole } from '../src/sprite-editor/templates';

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

function query(state: PickerState, text: string): PickerState {
	for (const character of text) state = typeQuery(state, character);
	return state;
}

function chooseRole(state: PickerState, role: SpriteRole): PickerState {
	state = beginNewSprite(state);
	for (
		let attempts = 0;
		attempts < 5 && newSpriteRole(state) !== role;
		attempts++
	)
		state = newSpriteMoveRole(state, 1);
	return newSpriteChooseRole(state);
}

function typeId(state: PickerState, id: string): PickerState {
	for (const character of id) state = newSpriteTypeId(state, character);
	return state;
}

describe('completed picker operations', () => {
	test('filtering and launching resolves the selected semantic asset', () => {
		expect(pickerLaunch(query(openPicker(inventory()), 'town'))).toEqual({
			kind: 'zone',
			id: 'town-01',
		});
		expect(pickerLaunch(query(openPicker(inventory()), 'sword'))).toEqual({
			kind: 'sprite',
			role: 'weapon',
			id: 'sword',
		});
		expect(pickerLaunch(query(openPicker(inventory()), 'missing'))).toBeNull();
	});

	test('cursor movement launches entries in deterministic role/id order', () => {
		const state = openPicker(inventory());
		const entries = visibleEntries(state);
		for (let index = 0; index < entries.length; index++)
			expect(pickerLaunch(moveCursor(state, index))).toEqual(entries[index]);
	});

	test.each([
		'sprite',
		'zone',
	] as const)('%s filtering exposes and launches only that asset kind', (kind) => {
		const state = openPicker(inventory(), kind);
		expect(visibleEntries(state).every((entry) => entry.kind === kind)).toBe(
			true,
		);
		expect(pickerLaunch(state)?.kind).toBe(kind);
	});

	test('a new Sprite flow completes as a role/id launch target', () => {
		let state = chooseRole(openPicker(inventory()), 'hat');
		state = typeId(state, 'new_hat-2');
		expect(newSpriteError(state)).toBeNull();
		expect(commitNewSprite(state)).toEqual({
			kind: 'sprite',
			role: 'hat',
			id: 'new_hat-2',
		});
	});

	test('a colliding Sprite id cannot complete creation', () => {
		const state = typeId(chooseRole(openPicker(inventory()), 'hat'), 'cap');
		expect(newSpriteError(state)).not.toBeNull();
		expect(commitNewSprite(state)).toBeNull();
	});

	test('invalid id characters never enter the completed target', () => {
		const state = typeId(
			chooseRole(openPicker(inventory()), 'form'),
			'a b/c.d-1',
		);
		expect(commitNewSprite(state)).toEqual({
			kind: 'sprite',
			role: 'form',
			id: 'abcd-1',
		});
	});
});

describe('picker grouping law', () => {
	test('sections partition the visible entries by kind and Sprite role without changing order', () => {
		const state = openPicker(inventory());
		const visible = visibleEntries(state);
		const sections = pickerSections(state);
		expect(sections.flatMap((section) => section.entries)).toEqual(visible);
		for (const section of sections) {
			expect(visible[section.startIndex]).toEqual(section.entries[0]);
			expect(
				section.entries.every((entry) =>
					entry.kind === 'sprite'
						? section.kind === 'sprite' && entry.role === section.role
						: section.kind === 'zone',
				),
			).toBe(true);
		}
	});
});
