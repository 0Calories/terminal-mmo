import { type RGBAQuad, SCENE_PALETTE } from '@mmo/core/entities';
import { SENTINEL } from './sprite';

const RESERVED_KEYS = new Set(['p', 'a']);

const DEFAULT_KEY = 'p';

const ANIMATION_NAME_RE = /^[A-Za-z0-9:_-]+$/;

const DEFAULT_ANIMATION_FPS = 5;

const SECTION_RE = /^---\s+(\S+)(?:\s+(\d+))?\s*$/;

export type SpriteSeverity = 'error' | 'warning';

export interface SpriteDiagnostic {
	severity: SpriteSeverity;
	spriteId: string;
	message: string;

	frame?: string;
	cell?: { x: number; y: number };
}

export interface SpriteAnchor {
	x: number;
	y: number;
}

export interface SpriteFrameDoc {
	rows: readonly string[];
	colors: readonly string[];
	bg: readonly string[];
	anchors: Readonly<Record<string, SpriteAnchor>>;
}

export interface SpriteAnimationDoc {
	name: string;
	fps?: number;
	frames: readonly SpriteFrameDoc[];
}

export interface SpriteDoc {
	id: string;
	key: string;
	baseline: number;

	accent?: string;
	anchors: Readonly<Record<string, SpriteAnchor>>;
	animations: readonly SpriteAnimationDoc[];
	colors: Readonly<Record<string, RGBAQuad>>;
}

export function allFrames(doc: SpriteDoc): SpriteFrameDoc[] {
	return doc.animations.flatMap((a) => a.frames);
}

export function defaultFrame(doc: SpriteDoc): SpriteFrameDoc | undefined {
	return doc.animations[0]?.frames[0];
}

export interface FrameLocation {
	animation: SpriteAnimationDoc;
	index: number;
	frame: SpriteFrameDoc;
	label: string;
}

export function frameLabelAt(
	animation: SpriteAnimationDoc,
	index: number,
): string {
	return animation.frames.length === 1
		? animation.name
		: `${animation.name} ${index}`;
}

export function frameLocations(doc: SpriteDoc): FrameLocation[] {
	const out: FrameLocation[] = [];
	for (const animation of doc.animations) {
		animation.frames.forEach((frame, index) => {
			out.push({
				animation,
				index,
				frame,
				label: frameLabelAt(animation, index),
			});
		});
	}
	return out;
}

export function findFrame(
	doc: SpriteDoc,
	label: string,
): FrameLocation | undefined {
	return frameLocations(doc).find((l) => l.label === label);
}

export function mapDocFrames(
	doc: SpriteDoc,
	fn: (frame: SpriteFrameDoc) => SpriteFrameDoc,
): SpriteDoc {
	return {
		...doc,
		animations: doc.animations.map((a) => ({
			...a,
			frames: a.frames.map(fn),
		})),
	};
}

interface DiagnosticLocation {
	frame?: string;
	cell?: { x: number; y: number };
}

type Reporter = (
	severity: SpriteSeverity,
	message: string,
	at?: DiagnosticLocation,
) => void;

function createReporter(diagnostics: SpriteDiagnostic[], id: string): Reporter {
	return (severity, message, at) => {
		diagnostics.push({
			severity,
			spriteId: id,
			message,
			...(at?.frame !== undefined ? { frame: at.frame } : {}),
			...(at?.cell !== undefined ? { cell: at.cell } : {}),
		});
	};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isInt(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v);
}

function gridFromLines(raw: readonly string[]): string[] {
	const lines = raw.slice();
	while (lines.length > 0 && lines[0].trim() === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	const width = lines.reduce((w, l) => Math.max(w, l.length), 0);
	return lines.map((l) => l.padEnd(width, ' '));
}

interface SectionSplit {
	artLines: string[];
	colorsLines: string[] | null;
	bgLines: string[] | null;
	duplicateColors: boolean;
	duplicateBg: boolean;
}

function splitSection(contentLines: readonly string[]): SectionSplit {
	const markers: { type: 'colors' | 'bg'; idx: number }[] = [];
	contentLines.forEach((l, idx) => {
		const t = l.trim();
		if (t === '@colors') markers.push({ type: 'colors', idx });
		else if (t === '@bg') markers.push({ type: 'bg', idx });
	});
	const artEnd = markers.length > 0 ? markers[0].idx : contentLines.length;
	const artLines = contentLines.slice(0, artEnd);
	let colorsLines: string[] | null = null;
	let bgLines: string[] | null = null;
	let duplicateColors = false;
	let duplicateBg = false;
	for (let i = 0; i < markers.length; i++) {
		const m = markers[i];
		const rangeEnd =
			i + 1 < markers.length ? markers[i + 1].idx : contentLines.length;
		const rangeLines = contentLines.slice(m.idx + 1, rangeEnd);
		if (m.type === 'colors') {
			if (colorsLines === null) colorsLines = rangeLines;
			else duplicateColors = true;
		} else {
			if (bgLines === null) bgLines = rangeLines;
			else duplicateBg = true;
		}
	}
	return { artLines, colorsLines, bgLines, duplicateColors, duplicateBg };
}

function parseAnchorEntries(
	value: unknown,
	report: Reporter,
	label: string,
): Record<string, SpriteAnchor> {
	const out: Record<string, SpriteAnchor> = {};
	if (!isPlainObject(value)) {
		report('error', `invalid ${label}: expected an object`);
		return out;
	}
	for (const [name, v] of Object.entries(value)) {
		if (Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1])) {
			out[name] = { x: v[0], y: v[1] };
		} else {
			report('error', `invalid anchor entry '${name}' in ${label}`);
		}
	}
	return out;
}

interface HeaderAnimation {
	name: string;
	fps?: number;
	overrides: Map<number, Record<string, SpriteAnchor>>;
}

interface ParsedHeader {
	key: string;
	baseline: number;
	accent?: string;
	anchors: Record<string, SpriteAnchor>;
	animations: HeaderAnimation[];
	colors: Record<string, RGBAQuad>;
}

function parseHeaderAnimations(
	value: unknown,
	report: Reporter,
): HeaderAnimation[] {
	const out: HeaderAnimation[] = [];
	if (!Array.isArray(value)) {
		report('error', "invalid 'animations': expected an array");
		return out;
	}
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isPlainObject(entry)) {
			report('error', 'invalid animation entry: expected an object');
			continue;
		}
		const name = entry.name;
		if (typeof name !== 'string' || !ANIMATION_NAME_RE.test(name)) {
			report(
				'error',
				`invalid animation name '${String(name)}' (${ANIMATION_NAME_RE.source})`,
			);
			continue;
		}
		if (seen.has(name)) {
			report('error', `duplicate animation '${name}'`);
			continue;
		}
		seen.add(name);

		for (const k of Object.keys(entry)) {
			if (k !== 'name' && k !== 'fps' && k !== 'anchors')
				report('warning', `unknown field '${k}' in animation '${name}'`);
		}

		let fps: number | undefined;
		if (entry.fps !== undefined) {
			if (
				typeof entry.fps === 'number' &&
				Number.isFinite(entry.fps) &&
				entry.fps > 0
			)
				fps = entry.fps;
			else report('error', `invalid fps for animation '${name}'`);
		}

		const overrides = new Map<number, Record<string, SpriteAnchor>>();
		if (entry.anchors !== undefined) {
			if (isPlainObject(entry.anchors)) {
				for (const [idxKey, v] of Object.entries(entry.anchors)) {
					const idx = Number(idxKey);
					if (!Number.isInteger(idx) || idx < 0 || String(idx) !== idxKey) {
						report(
							'error',
							`invalid frame index '${idxKey}' in animation '${name}' anchors`,
						);
						continue;
					}
					overrides.set(
						idx,
						parseAnchorEntries(v, report, `${name}[${idx}].anchors`),
					);
				}
			} else {
				report('error', `invalid 'anchors' for animation '${name}'`);
			}
		}

		out.push({ name, ...(fps !== undefined ? { fps } : {}), overrides });
	}
	return out;
}

function parseHeaderObject(
	header: Record<string, unknown>,
	report: Reporter,
): ParsedHeader {
	const known = new Set([
		'key',
		'baseline',
		'accent',
		'anchors',
		'animations',
		'colors',
		'id',
	]);
	for (const k of Object.keys(header)) {
		if (!known.has(k)) {
			report('warning', `unknown header field '${k}'`);
		}
	}

	if ('id' in header) {
		report(
			'error',
			"header 'id' is ignored (identity is the filename, ADR 0011)",
		);
	}

	let key = DEFAULT_KEY;
	if (header.key !== undefined) {
		if (
			typeof header.key === 'string' &&
			header.key.length === 1 &&
			header.key !== SENTINEL &&
			header.key !== ' '
		) {
			key = header.key;
		} else {
			report(
				'error',
				`invalid 'key': must be a single non-space, non-'${SENTINEL}' character`,
			);
		}
	}

	let baseline = 0;
	if (header.baseline !== undefined) {
		if (isNonNegInt(header.baseline)) {
			baseline = header.baseline;
		} else {
			report('error', "invalid 'baseline': must be an integer >= 0");
		}
	}

	let accent: string | undefined;
	if (header.accent !== undefined) {
		if (typeof header.accent === 'string' && header.accent.length === 1) {
			accent = header.accent;
		} else {
			report('error', "invalid 'accent': must be a single character");
		}
	}

	const anchors =
		header.anchors !== undefined
			? parseAnchorEntries(header.anchors, report, "'anchors'")
			: {};

	const animations =
		header.animations !== undefined
			? parseHeaderAnimations(header.animations, report)
			: [];

	const colors: Record<string, RGBAQuad> = {};
	if (header.colors !== undefined) {
		if (isPlainObject(header.colors)) {
			for (const [k, v] of Object.entries(header.colors)) {
				if (RESERVED_KEYS.has(k)) {
					report('error', `reserved recolor key '${k}' cannot be redefined`);
					continue;
				}
				if (k.length !== 1) {
					report(
						'error',
						`invalid color key '${k}': must be a single character`,
					);
					continue;
				}
				if (
					Array.isArray(v) &&
					v.length === 4 &&
					v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
				) {
					colors[k] = v as unknown as RGBAQuad;
				} else {
					report('error', `invalid color entry '${k}'`);
				}
			}
		} else {
			report('error', "invalid 'colors': expected an object");
		}
	}

	return {
		key,
		baseline,
		...(accent !== undefined ? { accent } : {}),
		anchors,
		animations,
		colors,
	};
}

function knownColorKey(
	k: string,
	fileColors: Record<string, RGBAQuad>,
): boolean {
	return k in SCENE_PALETTE || RESERVED_KEYS.has(k) || k in fileColors;
}

interface SectionGrids {
	rows: string[];
	colors: string[];
	bg: string[];
}

interface RawSection {
	animation: string;
	index: number | null;
	label: string;
	contentStart: number;
	contentEnd: number;
}

export function parseSpriteFile(
	text: string,
	id: string,
): { doc: SpriteDoc | null; diagnostics: SpriteDiagnostic[] } {
	const diagnostics: SpriteDiagnostic[] = [];
	const report = createReporter(diagnostics, id);
	const lines = text.split('\n');

	let firstSectionIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (SECTION_RE.test(lines[i])) {
			firstSectionIdx = i;
			break;
		}
	}

	const headerText =
		firstSectionIdx === -1
			? lines.join('\n')
			: lines.slice(0, firstSectionIdx).join('\n');

	let headerValue: unknown = {};
	if (headerText.trim() !== '') {
		try {
			headerValue = JSON.parse(headerText);
		} catch {
			report('error', 'invalid header JSON');
			return { doc: null, diagnostics };
		}
		if (!isPlainObject(headerValue)) {
			report('error', 'header must be a JSON object');
			return { doc: null, diagnostics };
		}
	}

	const header = parseHeaderObject(
		headerValue as Record<string, unknown>,
		report,
	);

	const rawSections: RawSection[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = SECTION_RE.exec(lines[i]);
		if (!m) continue;
		const animation = m[1];
		const index = m[2] !== undefined ? Number(m[2]) : null;
		const label = index === null ? animation : `${animation} ${index}`;
		rawSections.push({
			animation,
			index,
			label,
			contentStart: i + 1,
			contentEnd: lines.length,
		});
	}
	for (let s = 0; s < rawSections.length; s++) {
		rawSections[s].contentEnd =
			s + 1 < rawSections.length
				? rawSections[s + 1].contentStart - 1
				: lines.length;
	}

	const gridsByLabel = new Map<string, SectionGrids>();
	for (const sec of rawSections) {
		const grids = parseSectionGrids(
			lines.slice(sec.contentStart, sec.contentEnd),
			sec.label,
			header,
			report,
		);
		if (grids !== null) gridsByLabel.set(sec.label, grids);
	}

	const declared = new Map(header.animations.map((a) => [a.name, a]));
	const sectionsByAnimation = new Map<string, RawSection[]>();
	for (const sec of rawSections) {
		if (!declared.has(sec.animation)) {
			report(
				'error',
				`section '${sec.label}' references undeclared animation '${sec.animation}'`,
				{ frame: sec.label },
			);
			continue;
		}
		const list = sectionsByAnimation.get(sec.animation) ?? [];
		list.push(sec);
		sectionsByAnimation.set(sec.animation, list);
	}

	const animations: SpriteAnimationDoc[] = [];
	for (const decl of header.animations) {
		const secs = sectionsByAnimation.get(decl.name) ?? [];
		if (secs.length === 0) {
			report('error', `animation '${decl.name}' has no frame sections`);
			continue;
		}

		const byIndex = new Map<number, RawSection>();
		let indexError = false;
		if (secs.length === 1 && secs[0].index === null) {
			byIndex.set(0, secs[0]);
		} else {
			for (const sec of secs) {
				if (sec.index === null) {
					report(
						'error',
						`animation '${decl.name}' has multiple frames, so section '${sec.label}' needs an index`,
						{ frame: sec.label },
					);
					indexError = true;
					continue;
				}
				if (byIndex.has(sec.index)) {
					report('error', `duplicate frame '${sec.label}'`, {
						frame: sec.label,
					});
					indexError = true;
					continue;
				}
				byIndex.set(sec.index, sec);
			}
		}
		if (indexError) continue;
		const count = byIndex.size;
		let contiguous = true;
		for (let i = 0; i < count; i++) {
			if (!byIndex.has(i)) {
				report(
					'error',
					`animation '${decl.name}' has non-contiguous frame indices (missing index ${i})`,
				);
				contiguous = false;
				break;
			}
		}
		if (!contiguous) continue;

		const frames: SpriteFrameDoc[] = [];
		let allGridsPresent = true;
		for (let i = 0; i < count; i++) {
			const sec = byIndex.get(i) as RawSection;
			const grids = gridsByLabel.get(sec.label);
			if (grids === undefined) {
				allGridsPresent = false;
				break;
			}
			const overrides = decl.overrides.get(i) ?? {};
			for (const anchorName of Object.keys(overrides)) {
				if (!(anchorName in header.anchors)) {
					report('warning', `override of undeclared anchor '${anchorName}'`, {
						frame: sec.label,
					});
				}
			}
			frames.push({
				rows: grids.rows,
				colors: grids.colors,
				bg: grids.bg,
				anchors: overrides,
			});
		}
		if (!allGridsPresent) continue;

		for (const idx of decl.overrides.keys()) {
			if (idx >= count) {
				report(
					'warning',
					`anchor override for missing frame index ${idx} in animation '${decl.name}'`,
				);
			}
		}

		animations.push({
			name: decl.name,
			...(decl.fps !== undefined ? { fps: decl.fps } : {}),
			frames,
		});
	}

	if (animations.length === 0) {
		report('error', 'no valid animations');
		return { doc: null, diagnostics };
	}

	for (const a of animations) {
		a.frames.forEach((f, i) => {
			const effective = { ...header.anchors, ...f.anchors };
			const h = f.rows.length;
			const w = h > 0 ? f.rows[0].length : 0;
			const label = a.frames.length === 1 ? a.name : `${a.name} ${i}`;
			for (const [anchorName, anc] of Object.entries(effective)) {
				if (anc.x < 0 || anc.y < 0 || anc.x >= w || anc.y >= h) {
					report('warning', `anchor '${anchorName}' out of bounds`, {
						frame: label,
						cell: { x: anc.x, y: anc.y },
					});
				}
			}
		});
	}

	const doc: SpriteDoc = {
		id,
		key: header.key,
		baseline: header.baseline,
		...(header.accent !== undefined ? { accent: header.accent } : {}),
		anchors: header.anchors,
		animations,
		colors: header.colors,
	};

	return { doc, diagnostics };
}

function parseSectionGrids(
	content: readonly string[],
	label: string,
	header: ParsedHeader,
	report: Reporter,
): SectionGrids | null {
	const split = splitSection(content);
	if (split.duplicateColors) {
		report('error', '@colors appears more than once in this section', {
			frame: label,
		});
	}
	if (split.duplicateBg) {
		report('error', '@bg appears more than once in this section', {
			frame: label,
		});
	}

	const artRaw = gridFromLines(split.artLines);
	const h = artRaw.length;
	const w = h > 0 ? artRaw[0].length : 0;
	if (h === 0 || w === 0) {
		report('error', `empty frame '${label}'`, { frame: label });
		return null;
	}
	const artRows = artRaw.map((row) =>
		Array.from(row, (ch) => (ch === SENTINEL || ch === ' ' ? ' ' : ch)).join(
			'',
		),
	);

	let colorsGrid: string[] | null = null;
	if (split.colorsLines !== null) {
		const raw = gridFromLines(split.colorsLines);
		const ch = raw.length;
		const cw = ch > 0 ? raw[0].length : 0;
		if (ch !== h || cw !== w) {
			report(
				'error',
				`@colors grid dimensions (${cw}x${ch}) do not match art (${w}x${h})`,
				{ frame: label },
			);
		} else {
			colorsGrid = raw;
		}
	}
	const colorRows: string[] = [];
	for (let y = 0; y < h; y++) {
		let rowOut = '';
		for (let x = 0; x < w; x++) {
			const artInked = artRows[y][x] !== ' ';
			if (colorsGrid === null) {
				rowOut += artInked ? header.key : ' ';
				continue;
			}
			const raw = colorsGrid[y][x];
			const isBlank = raw === SENTINEL || raw === ' ';
			if (artInked) {
				const finalKey = isBlank ? header.key : raw;
				if (!isBlank && !knownColorKey(raw, header.colors)) {
					report('warning', `unknown color key '${raw}'`, {
						frame: label,
						cell: { x, y },
					});
				}
				rowOut += finalKey;
			} else {
				if (!isBlank) {
					report('warning', `color key on transparent cell '${raw}'`, {
						frame: label,
						cell: { x, y },
					});
				}
				rowOut += ' ';
			}
		}
		colorRows.push(rowOut);
	}

	let bgGrid: string[] | null = null;
	if (split.bgLines !== null) {
		const raw = gridFromLines(split.bgLines);
		const bh = raw.length;
		const bw = bh > 0 ? raw[0].length : 0;
		if (bh !== h || bw !== w) {
			report(
				'error',
				`@bg grid dimensions (${bw}x${bh}) do not match art (${w}x${h})`,
				{ frame: label },
			);
		} else {
			bgGrid = raw;
		}
	}
	const bgRows: string[] = [];
	for (let y = 0; y < h; y++) {
		let rowOut = '';
		for (let x = 0; x < w; x++) {
			if (bgGrid === null) {
				rowOut += ' ';
				continue;
			}
			const artInked = artRows[y][x] !== ' ';
			const raw = bgGrid[y][x];
			const isBlank = raw === SENTINEL || raw === ' ';
			if (isBlank) {
				rowOut += ' ';
			} else if (artInked) {
				if (!knownColorKey(raw, header.colors)) {
					report('warning', `unknown color key '${raw}'`, {
						frame: label,
						cell: { x, y },
					});
				}
				rowOut += raw;
			} else {
				report(
					'error',
					`bg key on transparent cell (${x},${y}) is inexpressible`,
					{ frame: label, cell: { x, y } },
				);
				rowOut += ' ';
			}
		}
		bgRows.push(rowOut);
	}

	return { rows: artRows, colors: colorRows, bg: bgRows };
}

function toGlyphRow(row: string): string {
	return row.replaceAll(' ', SENTINEL);
}

const HEADER_LINE_BUDGET = 78;

function inlineJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map((v) => inlineJson(v)).join(', ')}]`;
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return '{}';
		const body = entries
			.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`)
			.join(', ');
		return `{ ${body} }`;
	}
	return JSON.stringify(value);
}

function headerValue(value: unknown, indent: string): string {
	const inline = inlineJson(value);
	if (indent.length + inline.length <= HEADER_LINE_BUDGET) return inline;

	if (Array.isArray(value)) {
		if (value.every((v) => isPlainObject(v) || Array.isArray(v))) {
			const inner = `${indent}\t`;
			const body = value
				.map((v) => `${inner}${headerValue(v, inner)}`)
				.join(',\n');
			return `[\n${body}\n${indent}]`;
		}
		return inline;
	}
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return '{}';
		const inner = `${indent}\t`;
		const body = entries
			.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${headerValue(v, inner)}`)
			.join(',\n');
		return `{\n${body}\n${indent}}`;
	}
	return inline;
}

function formatHeader(header: Record<string, unknown>): string {
	const body = Object.entries(header)
		.map(([k, v]) => `\t${JSON.stringify(k)}: ${headerValue(v, '\t')}`)
		.join(',\n');
	return `{\n${body}\n}`;
}

function serializeAnimations(doc: SpriteDoc): Record<string, unknown>[] {
	return doc.animations.map((a) => {
		const obj: Record<string, unknown> = { name: a.name };
		if (a.fps !== undefined && a.fps !== DEFAULT_ANIMATION_FPS) obj.fps = a.fps;
		const overrides: Record<string, unknown> = {};
		a.frames.forEach((f, i) => {
			if (Object.keys(f.anchors).length === 0) return;
			overrides[String(i)] = Object.fromEntries(
				Object.entries(f.anchors).map(([n, anc]) => [n, [anc.x, anc.y]]),
			);
		});
		if (Object.keys(overrides).length > 0) obj.anchors = overrides;
		return obj;
	});
}

export function serializeSpriteFile(doc: SpriteDoc): string {
	const header: Record<string, unknown> = {};
	if (doc.key !== DEFAULT_KEY) header.key = doc.key;
	if (doc.baseline !== 0) header.baseline = doc.baseline;
	if (doc.accent !== undefined) header.accent = doc.accent;
	if (Object.keys(doc.anchors).length > 0) {
		header.anchors = Object.fromEntries(
			Object.entries(doc.anchors).map(([n, a]) => [n, [a.x, a.y]]),
		);
	}

	header.animations = serializeAnimations(doc);
	if (Object.keys(doc.colors).length > 0) {
		header.colors = Object.fromEntries(
			Object.entries(doc.colors).map(([k, q]) => [k, [q[0], q[1], q[2], q[3]]]),
		);
	}

	const lines: string[] = [];
	lines.push(...formatHeader(header).split('\n'));

	for (const animation of doc.animations) {
		const single = animation.frames.length === 1;
		animation.frames.forEach((frame, i) => {
			lines.push(
				single ? `--- ${animation.name}` : `--- ${animation.name} ${i}`,
			);
			for (const row of frame.rows) lines.push(toGlyphRow(row));

			const needColors = frame.rows.some((row, y) =>
				Array.from(row).some(
					(ch, x) => ch !== ' ' && frame.colors[y][x] !== doc.key,
				),
			);
			if (needColors) {
				lines.push('@colors');
				for (const row of frame.colors) lines.push(toGlyphRow(row));
			}

			const needBg = frame.bg.some((row) =>
				Array.from(row).some((ch) => ch !== ' '),
			);
			if (needBg) {
				lines.push('@bg');
				for (const row of frame.bg) lines.push(toGlyphRow(row));
			}
		});
	}

	return `${lines.join('\n')}\n`;
}
