import { describe, expect, test } from 'bun:test';
import { type Catalogs, parseZone, validateZone } from '@mmo/core/zones';
import { newZoneTemplate } from '../src/template';

const catalogs: Catalogs = { monsters: [], npcs: [] };

describe('newZoneTemplate', () => {
	test('a town template parses and validates clean', () => {
		const text = newZoneTemplate('town-99', 'town');
		const zone = parseZone(text, catalogs, 'town-99');
		expect(zone.id).toBe('town-99');
		expect(zone.type).toBe('town');
		expect(validateZone(zone, catalogs)).toEqual([]);
	});

	test('a fresh template carries an editable display name (#99)', () => {
		const zone = parseZone(
			newZoneTemplate('town-99', 'town'),
			catalogs,
			'town-99',
		);
		expect(zone.name).toBe('town-99');
	});

	test('a field template parses; its only error is the missing spawn', () => {
		const text = newZoneTemplate('field-99', 'field');
		const zone = parseZone(text, catalogs, 'field-99');
		expect(zone.type).toBe('field');
		const errors = validateZone(zone, catalogs).filter(
			(d) => d.severity === 'error',
		);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('at least one monster spawn');
	});
});
