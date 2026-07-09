/// <reference path="./zone-content.d.ts" />
import catalogsJson from '../../../zones/catalogs.json';
import dungeon01Text from '../../../zones/dungeon-01.zone' with {
	type: 'text',
};
import field01Text from '../../../zones/field-01.zone' with { type: 'text' };
import field02Text from '../../../zones/field-02.zone' with { type: 'text' };
import field03Text from '../../../zones/field-03.zone' with { type: 'text' };
import townText from '../../../zones/town-01.zone' with { type: 'text' };
import type { Zone } from './world';
import { type Catalogs, parseZone } from './zoneFormat';

export const CATALOGS: Catalogs = catalogsJson as Catalogs;

// Order matters: the start Zone (Town) is first.
export function loadZones(): Zone[] {
	return [
		parseZone(townText, CATALOGS, 'town-01'),
		parseZone(field01Text, CATALOGS, 'field-01'),
		parseZone(field02Text, CATALOGS, 'field-02'),
		parseZone(field03Text, CATALOGS, 'field-03'),
		parseZone(dungeon01Text, CATALOGS, 'dungeon-01'),
	];
}
