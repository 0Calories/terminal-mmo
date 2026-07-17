import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { readSpriteSourcesFromDir } from '@mmo/assets';
import {
	parseSpriteFile,
	type SpriteDiagnostic,
	validateSpriteSet,
} from '@mmo/render';
import type { CliDeps } from './cli';

const USAGE = [
	'usage:',
	"  forge sprite render <id>          parse + dump one .sprite file's frames as ASCII + diagnostics",
	'  forge sprite check [dir]          whole-set validation (CI; non-zero on error)',
	'  forge sprite edit <role>/<id>     open the pixel Sprite editor (a fresh template if the id is new)',
	'  forge sprite preview <id>         live Composited preview: the art rendered the way the game draws it',
].join('\n');

export function runSprite(argv: string[], deps: CliDeps): number {
	const [cmd, ...rest] = argv;
	switch (cmd) {
		case 'render':
			return cmdRender(rest, deps);
		case 'check':
			return cmdCheck(rest, deps);
		default:
			deps.log(USAGE);
			return cmd ? 1 : 0;
	}
}

const hasError = (diags: SpriteDiagnostic[]) =>
	diags.some((d) => d.severity === 'error');

export function formatSpriteDiagnostics(diags: SpriteDiagnostic[]): string {
	return diags
		.map((d) => {
			const sev = d.severity === 'error' ? 'error  ' : 'warning';
			const frame = d.frame ? ` #${d.frame}` : '';
			const at = d.cell ? ` (${d.cell.x},${d.cell.y})` : '';
			return `${sev} ${d.spriteId}${frame}${at}: ${d.message}`;
		})
		.join('\n');
}

export function findSpriteFile(root: string, id: string): string | undefined {
	if (id.includes('/') || id.endsWith('.sprite')) {
		// A slash id is tried as a filesystem path first (cwd-relative or
		// absolute), then against the sprites root — `forms/buddy` and the
		// picker's `dirForRole(role)/id` launch form both mean "under root"
		// when no such path exists where the tool was run.
		const candidates = isAbsolute(id)
			? [id]
			: [resolve(process.cwd(), id), join(root, id)];
		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate;
			if (!candidate.endsWith('.sprite')) {
				const withExt = `${candidate}.sprite`;
				if (existsSync(withExt)) return withExt;
			}
		}
		return undefined;
	}

	if (!existsSync(root)) return undefined;
	const target = `${id}.sprite`;
	const entries = readdirSync(root, { recursive: true }) as string[];
	for (const entry of entries) {
		if (basename(entry) === target) return join(root, entry);
	}
	return undefined;
}

// Whole-set validation, the sprite analogue of `zone check`: load every
// `.sprite` under the root, run the pure set validator, print the diagnostics,
// and exit non-zero on any error (warnings alone stay green). CI's gate.
function cmdCheck(args: string[], deps: CliDeps): number {
	const dir = args[0]
		? isAbsolute(args[0])
			? args[0]
			: resolve(process.cwd(), args[0])
		: deps.root;

	const sources = readSpriteSourcesFromDir(dir);
	const diags = validateSpriteSet(sources.values());

	if (sources.size === 0) deps.log(`check: no .sprite files found in ${dir}`);
	if (diags.length === 0) deps.log('✓ no issues');
	else deps.log(formatSpriteDiagnostics(diags));

	return hasError(diags) ? 1 : 0;
}

function cmdRender(args: string[], deps: CliDeps): number {
	const id = args[0];
	if (!id) {
		deps.log('render: missing <id>');
		return 1;
	}

	const path = findSpriteFile(deps.root, id);
	if (!path) {
		deps.log(`render: no such sprite '${id}'`);
		return 1;
	}

	const text = readFileSync(path, 'utf8');
	const spriteId = basename(path).replace(/\.sprite$/, '');
	const { doc, diagnostics } = parseSpriteFile(text, spriteId);

	if (!doc) {
		deps.log(formatSpriteDiagnostics(diagnostics));
		return 1;
	}

	const poseCount = Object.keys(doc.poses).length;
	deps.log(
		`${doc.id}  ${doc.frames.length} frame(s)  ${poseCount} pose(s)  baseline ${doc.baseline}`,
	);

	for (const frame of doc.frames) {
		const width = frame.rows.length > 0 ? frame.rows[0].length : 0;
		const height = frame.rows.length;
		deps.log('');
		deps.log(`--- ${frame.name}  ${width}×${height}`);
		for (const row of frame.rows) deps.log(row.replaceAll(' ', '·'));

		const hasCustomColors = frame.colors.some((row) =>
			[...row].some((ch) => ch !== ' ' && ch !== doc.key),
		);
		if (hasCustomColors) {
			deps.log('@colors');
			for (const row of frame.colors) deps.log(row.replaceAll(' ', '·'));
		}

		const hasBg = frame.bg.some((row) => /\S/.test(row));
		if (hasBg) {
			deps.log('@bg');
			for (const row of frame.bg) deps.log(row.replaceAll(' ', '·'));
		}
	}

	deps.log('');
	if (diagnostics.length === 0) deps.log('✓ no issues');
	else deps.log(formatSpriteDiagnostics(diagnostics));

	return hasError(diagnostics) ? 1 : 0;
}
