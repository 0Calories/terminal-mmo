/// <reference path="./zone-content.d.ts" />
// Runtime reader for the data-driven Zones (ADR 0008): hands each raw `.zone` text
// to the pure `parseZone`. Adding a Zone is two lines here plus the file — explicit
// imports, not a dir scan, so the shipped World is a fixed, reviewable list.
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

/** The shipped World, parsed. Order matters: the start Zone (Town) is first. */
export function loadZones(): Zone[] {
	// The id is the filename, not the header (ADR 0011); supplied here explicitly.
	return [
		parseZone(townText, CATALOGS, 'town-01'),
		parseZone(field01Text, CATALOGS, 'field-01'),
		parseZone(field02Text, CATALOGS, 'field-02'),
		parseZone(field03Text, CATALOGS, 'field-03'),
		// The instanced Dungeon (#240): ticked as a private per-party instance, never a
		// shared Zone (createServerWorld skips it).
		parseZone(dungeon01Text, CATALOGS, 'dungeon-01'),
	];
}
