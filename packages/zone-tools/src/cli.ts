import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Diagnostic, ZoneType } from '@mmo/shared';
import { validateZone, validateZoneSet } from '@mmo/shared';
import { formatDiagnostics } from './diagnostics';
import {
	loadCatalogs,
	loadZone,
	loadZoneSet,
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
	'  zone render <id>            parse + dump one Zone as ASCII + diagnostics',
	'  zone check [dir]            whole-set validation (CI; non-zero on error)',
	'  zone new <id> --type field|town   write a blank template to <id>.zone',
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
	const { zone, parseError } = loadZone(deps.root, id, catalogs);
	if (!zone) {
		deps.log(`render: cannot load '${id}': ${parseError}`);
		return 1;
	}
	deps.log(renderZone(zone));
	deps.log('');
	const diags = validateZone(zone, catalogs);
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
	const diags = [...parseErrors, ...validateZoneSet(zones, catalogs)];

	if (zones.length === 0 && parseErrors.length === 0)
		deps.log(`check: no .zone files found in ${dir}`);
	reportDiagnostics(diags, deps);
	return hasError(diags) ? 1 : 0;
}

function cmdNew(args: string[], deps: CliDeps): number {
	const id = args.find((a) => !a.startsWith('-'));
	const ti = args.indexOf('--type');
	const type = ti >= 0 ? args[ti + 1] : undefined;
	if (!id || (type !== 'field' && type !== 'town')) {
		deps.log('new: usage — zone new <id> --type field|town');
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
