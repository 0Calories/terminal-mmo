import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Diagnostic, ZoneType } from '@mmo/shared';
import { findOrphanGlyphs, validateZone, validateZoneSet } from '@mmo/shared';
import { formatDiagnostics } from './diagnostics';
import {
	listZoneIds,
	loadCatalogs,
	loadZone,
	loadZoneSet,
	renameZoneFile,
	rewritePortalTarget,
	zoneExists,
	zonePath,
} from './io';
import { renderZone } from './render';
import { newZoneTemplate } from './template';

/** Side-effect seam: where files live + how to emit output. Injected for tests. */
export interface CliDeps {
	root: string;
	log: (line: string) => void;
}

const USAGE = [
	'usage:',
	'  forge zone render <id>            parse + dump one Zone as ASCII + diagnostics',
	'  forge zone preview <id>           live, faithful TUI render (pan; re-renders on save)',
	'  forge zone play <id>              boot the Zone into the offline sim + walk around in it',
	'  forge zone edit <id>              entity-centric TUI editor (crosshair, rulers, auto-grow)',
	'  forge zone check [dir]            whole-set validation (CI; non-zero on error)',
	'  forge zone new <id> --type field|town   write a blank template to <id>.zone',
	'  forge zone rename <old> <new>     rename a Zone + rewrite every referencing Portal',
].join('\n');

/** Run the `zone` CLI. Returns a process exit code (0 = clean). */
export function run(argv: string[], deps: CliDeps): number {
	const [cmd, ...rest] = argv;
	switch (cmd) {
		case 'render':
			return cmdRender(rest, deps);
		case 'check':
			return cmdCheck(rest, deps);
		case 'new':
			return cmdNew(rest, deps);
		case 'rename':
			return cmdRename(rest, deps);
		default:
			deps.log(USAGE);
			return cmd ? 1 : 0;
	}
}

const hasError = (diags: Diagnostic[]) =>
	diags.some((d) => d.severity === 'error');

/** Print diagnostics, or a clean bill of health when there are none. */
function reportDiagnostics(diags: Diagnostic[], deps: CliDeps): void {
	if (diags.length === 0) deps.log('✓ no issues');
	else deps.log(formatDiagnostics(diags));
}

function cmdRender(args: string[], deps: CliDeps): number {
	const id = args[0];
	if (!id) {
		deps.log('render: missing <id>');
		return 1;
	}
	const catalogs = loadCatalogs(deps.root);
	const { zone, parseError, text } = loadZone(deps.root, id, catalogs);
	if (!zone) {
		deps.log(`render: cannot load '${id}': ${parseError}`);
		return 1;
	}
	deps.log(renderZone(zone));
	deps.log('');
	const diags = [
		...validateZone(zone, catalogs),
		...findOrphanGlyphs(text ?? '', id),
	];
	reportDiagnostics(diags, deps);
	return hasError(diags) ? 1 : 0;
}

function cmdCheck(args: string[], deps: CliDeps): number {
	const dir = args[0]
		? isAbsolute(args[0])
			? args[0]
			: resolve(deps.root, args[0])
		: deps.root;
	const catalogs = loadCatalogs(dir);
	const loaded = loadZoneSet(dir, catalogs);

	const parseErrors: Diagnostic[] = loaded
		.filter((l) => l.parseError)
		.map((l) => ({
			severity: 'error',
			zoneId: l.id,
			message: `parse failed: ${l.parseError}`,
		}));
	const zones = loaded.flatMap((l) => (l.zone ? [l.zone] : []));
	// Orphan glyphs need the raw source, which the parsed Zone has discarded.
	const orphans = loaded.flatMap((l) =>
		l.text ? findOrphanGlyphs(l.text, l.id) : [],
	);
	const diags = [
		...parseErrors,
		...validateZoneSet(zones, catalogs),
		...orphans,
	];

	if (zones.length === 0 && parseErrors.length === 0)
		deps.log(`check: no .zone files found in ${dir}`);
	reportDiagnostics(diags, deps);
	return hasError(diags) ? 1 : 0;
}

function cmdNew(args: string[], deps: CliDeps): number {
	const id = args.find((a) => !a.startsWith('-'));
	const ti = args.indexOf('--type');
	const type = ti >= 0 ? args[ti + 1] : undefined;
	if (!id || (type !== 'field' && type !== 'town' && type !== 'dungeon')) {
		deps.log('new: usage — zone new <id> --type field|town|dungeon');
		return 1;
	}
	if (zoneExists(deps.root, id)) {
		deps.log(`new: '${id}' already exists — refusing to overwrite`);
		return 1;
	}
	mkdirSync(deps.root, { recursive: true });
	const path = zonePath(deps.root, id);
	writeFileSync(path, newZoneTemplate(id, type as ZoneType));
	deps.log(`wrote ${path}`);
	return 0;
}

/**
 * Rename a Zone: a Zone's id is its filename (ADR 0011), so this moves
 * `<old>.zone` → `<new>.zone` AND rewrites every Portal `target` in the set that
 * referenced the old id — one mechanical, git-visible diff. The in-editor name
 * edit (#99) is for the decorative display label; identity is renamed here.
 */
function cmdRename(args: string[], deps: CliDeps): number {
	const [oldId, newId] = args.filter((a) => !a.startsWith('-'));
	if (!oldId || !newId) {
		deps.log('rename: usage — zone rename <old> <new>');
		return 1;
	}
	if (oldId === newId) {
		deps.log(`rename: '${oldId}' is already its own name`);
		return 1;
	}
	if (!zoneExists(deps.root, oldId)) {
		deps.log(`rename: no such Zone '${oldId}'`);
		return 1;
	}
	if (zoneExists(deps.root, newId)) {
		deps.log(`rename: '${newId}' already exists — refusing to overwrite`);
		return 1;
	}

	// Rewrite referencing Portals first (while the old file still exists), then move
	// the file. A Zone's own self-referencing Portal, if any, is rewritten too.
	let rewritten = 0;
	for (const id of listZoneIds(deps.root)) {
		const path = zonePath(deps.root, id);
		const text = readFileSync(path, 'utf8');
		const updated = rewritePortalTarget(text, oldId, newId);
		if (updated !== text) {
			writeFileSync(path, updated);
			rewritten++;
		}
	}
	renameZoneFile(deps.root, oldId, newId);

	const refs = rewritten === 1 ? '1 file' : `${rewritten} files`;
	deps.log(`renamed ${oldId} → ${newId} (rewrote portals in ${refs})`);
	return 0;
}
