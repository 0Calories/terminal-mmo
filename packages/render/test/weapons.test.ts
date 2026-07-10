// Unit tests for the weapon art registry (ADR 0031): pure compilation from
// SpriteSource entries plus catalog-index resolution — the forms.ts/hats.ts
// registry pattern applied to weapon art, with the extra catalog-reference hop
// (WEAPONS[i].sprite -> registry) that the wire-replicated numeric index rides.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_WEAPON, type Entity, parseTerrain, WEAPONS } from '@mmo/core';
import {
	buildWeaponRegistry,
	type CellBuffer,
	type RenderStyle,
	renderZoneScene,
	WEAPON_SPRITE_IDS,
	weaponSpriteById,
} from '../src';
import type { SpriteSource } from '../src/sprite-sources';

const SWORD_TEXT = readFileSync(
	join(import.meta.dir, '../../../sprites/weapons/sword.sprite'),
	'utf8',
);

function swordSource(id = 'sword'): SpriteSource {
	return { id, role: 'weapons', text: SWORD_TEXT };
}

// A minimal valid weapons source: idle/windup/active phase poses + grip.
const MINIMAL = `{ "accent": "s", "anchors": { "grip": [0, 0] } }
--- idle
AB
--- windup
AB
--- active
AB
`;

test('the real sword.sprite compiles to a weapon with all phase frames and its accent', () => {
	const registry = buildWeaponRegistry([swordSource()]);
	const ws = registry.get('sword');
	expect(ws).toBeDefined();
	expect(ws?.frames.idle).toBeDefined();
	expect(ws?.frames.windup).toBeDefined();
	expect(Array.isArray(ws?.frames.active)).toBe(true);
	expect(ws?.accent).toBe('s');
	// The sword's grip sits one cell left of its art (a negative offset).
	expect(ws?.grip).toEqual({ x: -1, y: 2 });
});

test('a source outside the weapons role is ignored', () => {
	const registry = buildWeaponRegistry([{ ...swordSource(), role: 'hats' }]);
	expect(registry.size).toBe(0);
});

test('a source with a broken header is skipped; the others still load', () => {
	const registry = buildWeaponRegistry([
		swordSource(),
		{ id: 'broken', role: 'weapons', text: 'not valid json {{{' },
		{ id: 'mini', role: 'weapons', text: MINIMAL },
	]);
	expect(registry.has('broken')).toBe(false);
	expect(registry.has('sword')).toBe(true);
	expect(registry.has('mini')).toBe(true);
});

test('a source that fails the weapons role profile is skipped', () => {
	// missing the active pose and the grip anchor -> role profile error.
	const bad = `--- idle
AB
--- windup
AB
`;
	const registry = buildWeaponRegistry([
		swordSource(),
		{ id: 'bad', role: 'weapons', text: bad },
	]);
	expect(registry.has('bad')).toBe(false);
	expect(registry.has('sword')).toBe(true);
});

test('a dangling sprite id resolves to undefined (registry miss)', () => {
	const registry = buildWeaponRegistry([swordSource()]);
	expect(registry.get('does-not-exist')).toBeUndefined();
});

test('WEAPON_SPRITE_IDS is sorted and every catalog entry resolves to art', () => {
	expect([...WEAPON_SPRITE_IDS]).toEqual([...WEAPON_SPRITE_IDS].sort());
	for (let i = 0; i < WEAPONS.length; i++) {
		const ws = weaponSpriteById(i);
		expect(ws).toBeDefined();
		expect(typeof ws?.accent).toBe('string');
	}
	// An out-of-range index falls back to the default weapon's art (like the
	// core catalog itself), never crashing or returning a foreign sprite.
	expect(weaponSpriteById(9999)).toBe(weaponSpriteById(DEFAULT_WEAPON));
	expect(weaponSpriteById(undefined)).toBe(weaponSpriteById(DEFAULT_WEAPON));
});

// --- Rendering an entity holding a weapon never crashes ------------------

interface Cell {
	ch: string;
	fg: string;
	bg: string;
}

class FakeBuffer implements CellBuffer<string> {
	readonly width: number;
	readonly height: number;
	cells = new Map<string, Cell>();
	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
	}
	clear(): void {
		this.cells.clear();
	}
	setCell(x: number, y: number, ch: string, fg: string, bg: string): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg });
	}
	setCellWithAlphaBlending(
		x: number,
		y: number,
		ch: string,
		fg: string,
		bg: string,
	): void {
		this.cells.set(`${x},${y}`, { ch, fg, bg });
	}
}

const STYLE: RenderStyle<string> = {
	bg: 'BG',
	terrainFg: 'TFG',
	terrainBg: 'TBG',
	portal: 'PORTAL',
	transparent: 'TR',
	hurt: 'HURT',
	nameplate: 'NAME',
	nameplateBg: 'NAMEBG',
	palette: { s: 'cS', k: 'cK', p: 'cP' },
	paletteDefault: 'DEF',
	cosmetics: { hues: ['hue0'], nameplates: ['np0'], nameplateBgs: ['bg0'] },
};

function makeEntity(over: Partial<Entity>): Entity {
	return {
		id: 1,
		type: 'player',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
		...over,
	} as Entity;
}

test('rendering an entity whose weapon index has no direct catalog entry never throws', () => {
	const buf = new FakeBuffer(24, 16);
	const terrain = parseTerrain(
		Array.from({ length: 16 }, (_, r) => (r >= 14 ? '#' : '.').repeat(24)),
	);
	const e = makeEntity({ type: 'player', x: 8, y: 7, weapon: 42 });
	expect(() =>
		renderZoneScene(
			buf,
			{ terrain, portals: [], npcs: [], entities: [e] },
			{ x: 0, y: 0 },
			STYLE,
		),
	).not.toThrow();
});
