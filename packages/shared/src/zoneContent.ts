/// <reference path="./zone-content.d.ts" />
// Runtime entry point for the data-driven Zones (ADR 0008): the repo-root `zones/`
// dir is the single source of truth for World content. Both the server (reads the
// files off disk at runtime) and the client (Bun inlines them into the published
// bundle) load the SAME files through these static imports, then hand the raw text
// to the pure `parseZone`. The tooling (forge) reads the same dir dynamically
// off disk for `zone render`/`check`/`preview`; this module is the *runtime* reader.
//
// Adding a Zone is two lines here plus the `.zone` file — deliberately explicit so
// the shipped World is a fixed, reviewable list, not a directory scan.
import catalogsJson from '../../../zones/catalogs.json';
import field01Text from '../../../zones/field-01.zone' with { type: 'text' };
import field02Text from '../../../zones/field-02.zone' with { type: 'text' };
import field03Text from '../../../zones/field-03.zone' with { type: 'text' };
import townText from '../../../zones/town-01.zone' with { type: 'text' };
import type { Zone } from './world';
import { type Catalogs, parseZone } from './zoneFormat';

/** The monster + NPC catalogs the authored Zones resolve their glyphs against. */
export const CATALOGS: Catalogs = catalogsJson as Catalogs;

/** The shipped World content, parsed. Order is the start Zone first (the Town: a
 * safe hub Players spawn into, then portal out to the Field). */
export function loadZones(): Zone[] {
	// The id is the filename (ADR 0011); these static imports name their files, so
	// the id is supplied here rather than read from the header.
	return [
		parseZone(townText, CATALOGS, 'town-01'),
		parseZone(field01Text, CATALOGS, 'field-01'),
		parseZone(field02Text, CATALOGS, 'field-02'),
		parseZone(field03Text, CATALOGS, 'field-03'),
	];
}
