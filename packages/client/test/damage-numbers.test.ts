import { describe, expect, test } from 'bun:test';
import { Compositor } from '@mmo/render/compositor';
import {
	DAMAGE_NUMBER,
	DamageNumberTracker,
	JITTER_CYCLE,
} from '../src/render/damage-numbers';
import type { DamageNumber } from '../src/render/present';

function num(over: Partial<DamageNumber> = {}): DamageNumber {
	return {
		style: 'hit',
		targetId: 9,
		x: 20,
		y: 8,
		value: 7,
		own: false,
		...over,
	};
}

const CAM = { x: 0, y: 0 };
const LIFE = DAMAGE_NUMBER.durMs;

describe('DamageNumberTracker lifetime', () => {
	test('a number lives for the tuned duration on the render clock, then expires', () => {
		const t = new DamageNumberTracker();
		t.spawn([num()], 1000);
		t.spawn([], 1000 + LIFE - 1);
		expect(t.numbers().length).toBe(1);
		t.spawn([], 1000 + LIFE);
		expect(t.numbers().length).toBe(0);
	});

	test('clear drops every live number', () => {
		const t = new DamageNumberTracker();
		t.spawn([num(), num({ targetId: 4 })], 0);
		t.clear();
		expect(t.numbers().length).toBe(0);
	});
});

describe('DamageNumberTracker overlap jitter', () => {
	test('an uncontested number spawns dead-centre', () => {
		const t = new DamageNumberTracker();
		t.spawn([num()], 0);
		const [only] = t.numbers();
		expect(only.px).toBe(Math.round(num().x * 2));
	});

	test('numbers landing while earlier ones still live walk the deterministic offset cycle', () => {
		const t = new DamageNumberTracker();
		t.spawn([num(), num(), num()], 0);
		const [a, b, c] = t.numbers();
		expect([b.px - a.px, b.py - a.py]).toEqual([...JITTER_CYCLE[1]]);
		expect([c.px - a.px, c.py - a.py]).toEqual([...JITTER_CYCLE[2]]);
	});

	test('the cycle resets once the target has no live numbers, so the next number is dead-centre again', () => {
		const t = new DamageNumberTracker();
		t.spawn([num(), num()], 0);
		t.spawn([num()], LIFE + 1);
		const [fresh] = t.numbers();
		expect(fresh.px).toBe(Math.round(num().x * 2));
	});

	test('the cycle is per target — a crowd on one target never displaces a lone number on another', () => {
		const t = new DamageNumberTracker();
		t.spawn([num(), num(), num({ targetId: 4, x: 30 })], 0);
		const lone = t.numbers().find((n) => n.targetId === 4);
		expect(lone?.px).toBe(30 * 2);
	});

	test('clear also resets the cycle', () => {
		const t = new DamageNumberTracker();
		t.spawn([num(), num()], 0);
		t.clear();
		t.spawn([num()], 1);
		expect(t.numbers()[0].px).toBe(Math.round(num().x * 2));
	});
});

describe('DamageNumberTracker predicted-hit conversion', () => {
	test('an own break converts the pending predicted number instead of spawning a second', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ own: true })], 0);
		t.spawn([num({ style: 'break', value: 12, own: true })], 100);

		expect(t.numbers().length).toBe(1);
		const [n] = t.numbers();
		expect(n.style).toBe('break');
		expect(n.value).toBe(12);
	});

	test('conversion restarts the lifetime so the break digits get their full flight', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ own: true })], 0);
		t.spawn([num({ style: 'break', value: 12, own: true })], 100);
		t.spawn([], 100 + LIFE - 1);
		expect(t.numbers().length).toBe(1);
	});

	test('conversion keeps the pending number where it spawned — jitter offset included', () => {
		const t = new DamageNumberTracker();
		t.spawn([num(), num({ own: true })], 0);
		const pending = t.numbers()[1];
		const spot = { px: pending.px, py: pending.py };
		t.spawn([num({ style: 'break', value: 12, own: true })], 100);

		const converted = t.numbers().find((n) => n.style === 'break');
		expect({ px: converted?.px, py: converted?.py }).toEqual(spot);
	});

	test('an own break converts the youngest pending number on its target', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ own: true, value: 3 })], 0);
		t.spawn([num({ own: true, value: 4 })], 50);
		t.spawn([num({ style: 'break', value: 12, own: true })], 100);

		expect(t.numbers().map((n) => n.style)).toEqual(['hit', 'break']);
		expect(t.numbers()[1].value).toBe(12);
	});

	test('a converted number is no longer pending — a second own break spawns fresh', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ own: true })], 0);
		t.spawn([num({ style: 'break', own: true })], 50);
		t.spawn([num({ style: 'break', own: true })], 100);
		expect(t.numbers().length).toBe(2);
	});

	test('a foreign break never converts — an observer sees the break number alongside the hit', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ own: true })], 0);
		t.spawn([num({ style: 'break' })], 100);
		expect(t.numbers().length).toBe(2);
	});

	test('an own break with nothing pending simply spawns the break number', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ style: 'break', own: true })], 0);
		expect(t.numbers().length).toBe(1);
		expect(t.numbers()[0].style).toBe('break');
	});

	test('conversion only matches its own target — pending numbers elsewhere stay pending', () => {
		const t = new DamageNumberTracker();
		t.spawn([num({ own: true })], 0);
		t.spawn([num({ style: 'break', own: true, targetId: 4 })], 100);
		expect(t.numbers().length).toBe(2);
		expect(t.numbers().map((n) => n.style)).toEqual(['hit', 'break']);
	});
});

function paintedCells(comp: Compositor): { count: number; alphas: number[] } {
	let count = 0;
	const alphas: number[] = [];
	for (let cy = 0; cy < comp.heightCells; cy++)
		for (let cx = 0; cx < comp.widthCells; cx++) {
			const cell = comp.cell(cx, cy);
			if (cell.char === ' ') continue;
			count++;
			alphas.push(cell.fg[3]);
		}
	return { count, alphas };
}

describe('DamageNumberTracker drawing', () => {
	function drawAt(ageFraction: number): { count: number; alphas: number[] } {
		const comp = new Compositor(40, 20);
		const t = new DamageNumberTracker();
		t.spawn([num({ x: 10, y: 12 })], 0);
		t.draw(comp, CAM, LIFE * ageFraction);
		return paintedCells(comp);
	}

	test('a mid-flight number paints digits into the compositor', () => {
		expect(drawAt(0.3).count).toBeGreaterThan(0);
	});

	test('the dissolve drops pixels over the last stretch of life but never fades the colour', () => {
		const early = drawAt(0.3);
		const late = drawAt(0.95);
		expect(late.count).toBeLessThan(early.count);
		expect(late.count).toBeGreaterThan(0);
		for (const a of late.alphas) expect(a).toBe(255);
	});

	test('an expired number paints nothing', () => {
		expect(drawAt(1).count).toBe(0);
	});
});
