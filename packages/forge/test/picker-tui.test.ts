import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { AssetInventory, LaunchTarget } from '../src/picker/model';
import { AssetPicker, type PickerKey } from '../src/picker/tui';

const key = (name: string, sequence = ''): PickerKey => ({ name, sequence });

function inventory(): AssetInventory {
	return {
		sprites: [
			{ role: 'form', id: 'buddy' },
			{ role: 'hat', id: 'cap' },
			{ role: 'hat', id: 'straw' },
		],
		zones: [{ id: 'field-01' }],
	};
}

async function mount(width = 80, height = 24) {
	const launched: LaunchTarget[] = [];
	const t = await createTestRenderer({ width, height });
	const picker = new AssetPicker(t.renderer, {
		inventory: inventory(),
		filterKind: null,
		onLaunch: (target) => launched.push(target),
		onQuit: () => {},
	});
	picker.attach(t.renderer.root);
	await t.renderOnce();
	return { ...t, picker, launched };
}

function firstVisibleRow(picker: AssetPicker): number {
	const rows = (picker as unknown as { rowHits: readonly { y: number }[] })
		.rowHits;
	const first = rows[0];
	if (!first) throw new Error('picker has no visible launch row');
	return first.y;
}

function mouseDown(
	picker: AssetPicker,
	event: { button: number; x: number; y: number },
): void {
	(
		picker as unknown as {
			mouseDown: (input: { button: number; x: number; y: number }) => void;
		}
	).mouseDown(event);
}

describe('Asset picker headless workflows', () => {
	test('keyboard and mouse launch the same visible authoring target', async () => {
		const keyboard = await mount();
		keyboard.picker.key(key('enter'));

		const mouse = await mount();
		mouseDown(mouse.picker, {
			button: 0,
			x: 0,
			y: firstVisibleRow(mouse.picker),
		});

		expect(keyboard.launched).toEqual([
			{ kind: 'sprite', role: 'form', id: 'buddy' },
		]);
		expect(mouse.launched).toEqual(keyboard.launched);
	});

	test('typeahead reaches and launches the matching asset', async () => {
		const t = await mount();
		for (const ch of 'straw') t.picker.key(key(ch, ch));
		t.picker.key(key('enter'));
		expect(t.launched).toEqual([{ kind: 'sprite', role: 'hat', id: 'straw' }]);
	});

	test('new-sprite collision blocks completion and remains recoverable', async () => {
		const t = await mount();
		t.picker.key(key('n', 'n'));
		t.picker.key(key('down'));
		t.picker.key(key('down'));
		t.picker.key(key('enter'));
		for (const ch of 'cap') t.picker.key(key(ch, ch));
		t.picker.key(key('enter'));
		expect(t.launched).toEqual([]);

		for (let i = 0; i < 3; i++) t.picker.key(key('backspace'));
		for (const ch of 'fedora') t.picker.key(key(ch, ch));
		t.picker.key(key('enter'));
		expect(t.launched).toEqual([{ kind: 'sprite', role: 'hat', id: 'fedora' }]);
	});

	test('a below-floor picker exposes no mouse target and recovers after resize', async () => {
		const t = await mount(30, 8);
		mouseDown(t.picker, { button: 0, x: 0, y: 4 });
		expect(t.launched).toEqual([]);

		t.resize(80, 24);
		await t.renderOnce();
		mouseDown(t.picker, {
			button: 0,
			x: 0,
			y: firstVisibleRow(t.picker),
		});
		expect(t.launched).toEqual([{ kind: 'sprite', role: 'form', id: 'buddy' }]);
	});
});
