import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInventory, readSpriteInventory } from '../src/picker/tui';

let dir: string;
let spritesRoot: string;
let zonesRoot: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'forge-picker-'));
	spritesRoot = join(dir, 'sprites');
	zonesRoot = join(dir, 'zones');
	const write = (p: string) => {
		mkdirSync(join(p, '..'), { recursive: true });
		writeFileSync(p, '# fixture\n');
	};
	write(join(spritesRoot, 'forms', 'buddy.sprite'));
	write(join(spritesRoot, 'hats', 'cap.sprite'));
	write(join(spritesRoot, 'mystery', 'orphan.sprite'));
	write(join(zonesRoot, 'town-01.zone'));
	write(join(zonesRoot, 'field-01.zone'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readSpriteInventory', () => {
	test('maps role directories to roles and skips unknown dirs', () => {
		const sprites = readSpriteInventory(spritesRoot);
		expect(sprites).toContainEqual({ role: 'form', id: 'buddy' });
		expect(sprites).toContainEqual({ role: 'hat', id: 'cap' });
		expect(sprites.some((s) => s.id === 'orphan')).toBe(false);
	});

	test('a missing sprites root yields no sprites', () => {
		expect(readSpriteInventory(join(dir, 'nope'))).toEqual([]);
	});
});

describe('readInventory', () => {
	test('assembles sprites + zones from the two roots', () => {
		const inv = readInventory(spritesRoot, zonesRoot);
		expect(inv.sprites.length).toBe(2);
		expect(inv.zones.map((z) => z.id).sort()).toEqual(['field-01', 'town-01']);
	});
});
