import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { AssetInventory, LaunchTarget } from '../src/picker/model';
import { AssetPicker, type PickerKey } from '../src/picker/tui';

const seq = (s: string): PickerKey => ({ name: s, sequence: s });
const named = (name: string): PickerKey => ({ name });

function inventory(): AssetInventory {
	return {
		sprites: [
			{ role: 'form', id: 'buddy' },
			{ role: 'hat', id: 'cap' },
			{ role: 'hat', id: 'straw' },
			{ role: 'weapon', id: 'sword' },
		],
		zones: [{ id: 'field-01' }, { id: 'town-01' }],
	};
}

async function mount(opts: {
	inventory?: AssetInventory;
	filterKind?: 'sprite' | 'zone' | null;
	width?: number;
	height?: number;
}) {
	const t = await createTestRenderer({
		width: opts.width ?? 80,
		height: opts.height ?? 24,
	});
	const launched: LaunchTarget[] = [];
	let quit = false;
	const picker = new AssetPicker(t.renderer, {
		inventory: opts.inventory ?? inventory(),
		filterKind: opts.filterKind ?? null,
		onLaunch: (target) => launched.push(target),
		onQuit: () => {
			quit = true;
		},
	});
	picker.attach(t.renderer.root);
	await t.renderOnce();
	const render = async () => {
		await t.renderOnce();
		return t.captureCharFrame();
	};
	return { ...t, picker, render, launched, isQuit: () => quit };
}

describe('grouped list render', () => {
	test('shows role sections and a zones section with their entries', async () => {
		const t = await mount({});
		const frame = t.captureCharFrame();
		expect(frame).toContain('forms');
		expect(frame).toContain('hats');
		expect(frame).toContain('weapons');
		expect(frame).toContain('zones');
		expect(frame).toContain('buddy');
		expect(frame).toContain('straw');
		expect(frame).toContain('town-01');

		expect(frame).not.toContain('monsters');
	});

	test('the cursor marker sits on the first entry and moves with arrows', async () => {
		const t = await mount({});
		expect(t.captureCharFrame()).toContain('▸ buddy');

		t.picker.key(named('down'));
		expect(await t.render()).toContain('▸ sword');
	});
});

describe('typeahead + pre-filter', () => {
	test('typing filters the list down to matches', async () => {
		const t = await mount({});
		for (const ch of 'straw') t.picker.key(seq(ch));
		const frame = await t.render();
		expect(frame).toContain('filter: straw');
		expect(frame).toContain('straw');
		expect(frame).not.toContain('buddy');
		expect(frame).not.toContain('sword');
	});

	test('the sprite pre-filter hides zones; the zone pre-filter hides sprites', async () => {
		const sp = await mount({ filterKind: 'sprite' });
		const spFrame = sp.captureCharFrame();
		expect(spFrame).toContain('pick a sprite');
		expect(spFrame).toContain('forms');
		expect(spFrame).not.toContain('town-01');

		const zn = await mount({ filterKind: 'zone' });
		const znFrame = zn.captureCharFrame();
		expect(znFrame).toContain('pick a zone');
		expect(znFrame).toContain('town-01');
		expect(znFrame).not.toContain('buddy');
	});
});

describe('launch dispatch', () => {
	test('enter launches the sprite editor target under the cursor', async () => {
		const t = await mount({});
		t.picker.key(named('enter'));
		expect(t.launched).toEqual([{ kind: 'sprite', role: 'form', id: 'buddy' }]);
	});

	test('enter on a zone launches the zone editor target', async () => {
		const t = await mount({ filterKind: 'zone' });
		t.picker.key(named('enter'));
		expect(t.launched).toEqual([{ kind: 'zone', id: 'field-01' }]);
	});

	test('esc quits', async () => {
		const t = await mount({});
		t.picker.key(named('escape'));
		expect(t.isQuit()).toBe(true);
	});
});

describe('new-sprite flow (`n`)', () => {
	test('n opens the role picker, then id entry, then launches a template target', async () => {
		const t = await mount({});
		t.picker.key(seq('n'));
		const roleFrame = await t.render();
		expect(roleFrame).toContain('new sprite');
		expect(roleFrame).toContain('pick a role');

		t.picker.key(named('down'));
		t.picker.key(named('down'));
		t.picker.key(named('enter'));
		const idFrame = await t.render();
		expect(idFrame).toContain('role: hats');

		for (const ch of 'fedora') t.picker.key(seq(ch));
		t.picker.key(named('enter'));
		expect(t.launched).toEqual([{ kind: 'sprite', role: 'hat', id: 'fedora' }]);
	});

	test('a colliding id shows an error and refuses to launch', async () => {
		const t = await mount({});
		t.picker.key(seq('n'));
		t.picker.key(named('down'));
		t.picker.key(named('down'));
		t.picker.key(named('enter'));
		for (const ch of 'cap') t.picker.key(seq(ch));
		const frame = await t.render();
		expect(frame).toContain('already exists');
		t.picker.key(named('enter'));
		expect(t.launched).toEqual([]);
	});
});

describe('min-size placard', () => {
	test('below the floor a placard replaces the list and reports the live size', async () => {
		const t = await mount({ width: 30, height: 8 });
		const frame = t.captureCharFrame();
		expect(frame).toContain('picker needs');
		expect(frame).toContain('30×8');
		expect(frame).not.toContain('forms');
	});
});
