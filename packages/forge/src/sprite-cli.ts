import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { readSpriteSourcesFromDir } from '@mmo/assets';
import {
	allFrames,
	buildSceneStyle,
	type CellBuffer,
	frameLabelAt,
	parseSpriteFile,
	type SpriteDiagnostic,
	type SpriteDoc,
	validateSpriteSet,
} from '@mmo/render';
import type { CliDeps } from './cli';
import {
	previewStances,
	RAIL_TOOLS,
	renderComposite,
	roleForDir,
	styleWithLocalColors,
	TOOL_GLYPH_FALLBACKS,
} from './sprite-editor';

const USAGE = [
	'usage:',
	"  forge sprite render <id>          parse + dump one .sprite file's frames as ASCII + diagnostics",
	'  forge sprite render <id> --composite [--stance <id>]',
	'                                    headless Composited preview: the art as the game draws it',
	'  forge sprite check [dir]          whole-set validation (CI; non-zero on error)',
	'  forge sprite edit <role>/<id>     open the pixel Sprite editor (a fresh template if the id is new)',
	'  forge sprite glyphs               print the rail tool glyphs + fallbacks (eyeball tofu/width here)',
].join('\n');

export function runSprite(argv: string[], deps: CliDeps): number {
	const [cmd, ...rest] = argv;
	switch (cmd) {
		case 'render':
			return cmdRender(rest, deps);
		case 'check':
			return cmdCheck(rest, deps);
		case 'glyphs':
			return cmdGlyphs(deps);
		default:
			deps.log(USAGE);
			return cmd ? 1 : 0;
	}
}

function cmdGlyphs(deps: CliDeps): number {
	const row = RAIL_TOOLS.map((t) => {
		const fb = TOOL_GLYPH_FALLBACKS[t.tool];
		return `${t.label} ${t.glyph}${fb ? ` (fb ${fb})` : ''}`;
	}).join(' · ');
	deps.log(row);
	return 0;
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
	const composite = args.includes('--composite');
	const stanceAt = args.indexOf('--stance');
	const stanceArg = stanceAt >= 0 ? args[stanceAt + 1] : undefined;
	if (stanceAt >= 0 && stanceArg === undefined) {
		deps.log(
			'render: --stance needs an id (quote multi-word labels: "swing 0")',
		);
		return 1;
	}
	if (stanceAt >= 0 && !composite) {
		deps.log('render: --stance only applies with --composite');
		return 1;
	}
	const id = args.find(
		(a, i) => !a.startsWith('--') && (stanceAt < 0 || i !== stanceAt + 1),
	);
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

	if (composite)
		return cmdRenderComposite(path, doc, stanceArg, diagnostics, deps);

	const frames = allFrames(doc);
	const animationCount = doc.animations.length;
	deps.log(
		`${doc.id}  ${frames.length} frame(s)  ${animationCount} animation(s)  baseline ${doc.baseline}`,
	);

	for (const animation of doc.animations) {
		animation.frames.forEach((frame, index) => {
			const width = frame.rows.length > 0 ? frame.rows[0].length : 0;
			const height = frame.rows.length;
			deps.log('');
			deps.log(`--- ${frameLabelAt(animation, index)}  ${width}×${height}`);
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
		});
	}

	deps.log('');
	if (diagnostics.length === 0) deps.log('✓ no issues');
	else deps.log(formatSpriteDiagnostics(diagnostics));

	return hasError(diagnostics) ? 1 : 0;
}

class TextGrid implements CellBuffer<null> {
	readonly grid: string[][];
	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.grid = Array.from({ length: height }, () => Array(width).fill(' '));
	}
	clear(_bg: null): void {
		for (const row of this.grid) row.fill(' ');
	}
	setCell(x: number, y: number, ch: string): void {
		if (y >= 0 && y < this.height && x >= 0 && x < this.width)
			this.grid[y][x] = ch;
	}
	setCellWithAlphaBlending(x: number, y: number, ch: string): void {
		this.setCell(x, y, ch);
	}
}

const COMPOSITE_W = 48;
const COMPOSITE_H = 24;

function cmdRenderComposite(
	path: string,
	doc: SpriteDoc,
	stanceArg: string | undefined,
	diagnostics: SpriteDiagnostic[],
	deps: CliDeps,
): number {
	const role = roleForDir(basename(dirname(path)));
	if (!role) {
		deps.log(
			`render: cannot tell the role of '${path}' — --composite needs sprites/<role>/<id>.sprite`,
		);
		return 1;
	}

	const stances = previewStances(doc, role);
	const stance = stanceArg ?? stances[0]?.id ?? 'idle';
	if (stanceArg && !stances.some((s) => s.id === stanceArg)) {
		deps.log(
			`render: unknown stance '${stanceArg}' — available: ${stances.map((s) => s.id).join(' · ')}`,
		);
		return 1;
	}

	const style = styleWithLocalColors(
		buildSceneStyle(() => null),
		doc.colors,
		() => null,
	);
	const buf = new TextGrid(COMPOSITE_W, COMPOSITE_H);
	const drew = renderComposite(buf, doc, role, style, {
		facing: 1,
		stance,
		elapsedS: 0,
	});
	if (!drew) {
		deps.log(
			`render: '${doc.id}' cannot composite yet — the ${role} is missing required anchors or animations (run plain render for diagnostics)`,
		);
		return 1;
	}

	deps.log(`${doc.id}  ${role}  stance ${stance}`);
	deps.log(`stances: ${stances.map((s) => s.id).join(' · ')}`);
	deps.log('');

	const rows = buf.grid.map((r) => r.join(''));
	const inked = rows.map((r, y) => (r.trim() ? y : -1)).filter((y) => y >= 0);
	if (inked.length === 0) {
		deps.log('(nothing drawn)');
		return hasError(diagnostics) ? 1 : 0;
	}
	const y0 = inked[0];
	const y1 = inked[inked.length - 1];
	let x0 = COMPOSITE_W;
	let x1 = 0;
	for (const y of inked) {
		const row = rows[y];
		x0 = Math.min(x0, row.length - row.trimStart().length);
		x1 = Math.max(x1, row.trimEnd().length - 1);
	}
	for (let y = y0; y <= y1; y++)
		deps.log(rows[y].slice(x0, x1 + 1).replaceAll(' ', '·'));

	deps.log('');
	if (diagnostics.length === 0) deps.log('✓ no issues');
	else deps.log(formatSpriteDiagnostics(diagnostics));

	return hasError(diagnostics) ? 1 : 0;
}
