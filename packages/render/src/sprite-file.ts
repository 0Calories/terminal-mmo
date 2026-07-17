// The `.sprite` asset file format (ADR 0031): pure parse/serialize between
// `.sprite` text (JSON header + named visible-glyph frame sections with
// optional `@colors`/`@bg` grids) and a SpriteDoc. Grammar errors are
// diagnostics, never throws. Parse <-> serialize round-trips losslessly for
// any diagnostics-free document.
import { type RGBAQuad, SCENE_PALETTE } from '@mmo/core/entities';
import { SENTINEL } from './sprite';

// The dynamic recolor keys, reserved because their meaning is assigned at
// render time rather than declared in a file's `colors` header: 'p' is the
// cosmetic hue recolor key, 'a' is the weapon accent key (see CONTEXT.md and
// `WEAPON_ACCENT_KEY` in `./weapon-sprite`).
const RESERVED_KEYS = new Set(['p', 'a']);
// The default color key applied to inked cells when a file declares none.
const DEFAULT_KEY = 'p';
const FRAME_NAME_RE = /^[A-Za-z0-9:_-]+$/;
const SECTION_RE = /^---\s+(\S+)\s*$/;

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
	name: string;
	rows: readonly string[];
	colors: readonly string[];
	bg: readonly string[];
	anchors: Readonly<Record<string, SpriteAnchor>>;
}

export interface SpriteDoc {
	id: string;
	key: string;
	baseline: number;
	// The accent palette key a weapon's dynamic `a` channel resolves to at render
	// time (see `WEAPON_ACCENT_KEY`). Optional and role-agnostic in the format;
	// only the weapon compiler consumes it. Absent for non-weapon sprites.
	accent?: string;
	anchors: Readonly<Record<string, SpriteAnchor>>;
	animations: Readonly<Record<string, readonly string[]>>;
	fps: Readonly<Record<string, number>>;
	colors: Readonly<Record<string, RGBAQuad>>;
	frames: readonly SpriteFrameDoc[];
}

// Where a diagnostic occurred within a sprite file, beyond the sprite itself.
interface DiagnosticLocation {
	frame?: string;
	cell?: { x: number; y: number };
}

type Reporter = (
	severity: SpriteSeverity,
	message: string,
	at?: DiagnosticLocation,
) => void;

// Creates a `report` closure bound to one sprite's diagnostics array/id, so
// helpers push diagnostics without threading `(diagnostics, id)` everywhere.
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

// Anchors are seat *offsets*, not in-bounds cell references, so they may be any
// integer — a weapon grip legitimately sits one cell left of its art (x = -1).
// Out-of-range values still warn (a typo guard) but are not rejected.
function isInt(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v);
}

// Drop leading/trailing all-blank lines; right-pad to widest row.
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

interface ParsedHeader {
	key: string;
	baseline: number;
	accent?: string;
	anchors: Record<string, SpriteAnchor>;
	explicitAnimations: Record<string, string[]>;
	fpsRaw: Record<string, number>;
	colors: Record<string, RGBAQuad>;
	frameOverrides: Record<string, { anchors: Record<string, SpriteAnchor> }>;
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
		'fps',
		'colors',
		'frames',
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

	const explicitAnimations: Record<string, string[]> = {};
	if (header.animations !== undefined) {
		if (isPlainObject(header.animations)) {
			for (const [name, list] of Object.entries(header.animations)) {
				if (
					Array.isArray(list) &&
					list.length > 0 &&
					list.every((v) => typeof v === 'string')
				) {
					explicitAnimations[name] = list as string[];
				} else {
					report('error', `invalid animation entry '${name}'`);
				}
			}
		} else {
			report('error', "invalid 'animations': expected an object");
		}
	}

	const fpsRaw: Record<string, number> = {};
	if (header.fps !== undefined) {
		if (isPlainObject(header.fps)) {
			for (const [name, v] of Object.entries(header.fps)) {
				if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
					fpsRaw[name] = v;
				} else {
					report('error', `invalid fps entry '${name}'`);
				}
			}
		} else {
			report('error', "invalid 'fps': expected an object");
		}
	}

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

	const frameOverrides: Record<
		string,
		{ anchors: Record<string, SpriteAnchor> }
	> = {};
	if (header.frames !== undefined) {
		if (isPlainObject(header.frames)) {
			for (const [name, v] of Object.entries(header.frames)) {
				if (isPlainObject(v)) {
					const overrideAnchors =
						v.anchors !== undefined
							? parseAnchorEntries(v.anchors, report, `frames.${name}.anchors`)
							: {};
					frameOverrides[name] = { anchors: overrideAnchors };
				} else {
					report('error', `invalid frames override entry '${name}'`);
				}
			}
		} else {
			report('error', "invalid 'frames': expected an object");
		}
	}

	return {
		key,
		baseline,
		...(accent !== undefined ? { accent } : {}),
		anchors,
		explicitAnimations,
		fpsRaw,
		colors,
		frameOverrides,
	};
}

function knownColorKey(
	k: string,
	fileColors: Record<string, RGBAQuad>,
): boolean {
	return k in SCENE_PALETTE || RESERVED_KEYS.has(k) || k in fileColors;
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

	// Locate every section start.
	const sectionStarts: { idx: number; name: string }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = SECTION_RE.exec(lines[i]);
		if (m) sectionStarts.push({ idx: i, name: m[1] });
	}

	const seen = new Set<string>();
	const frames: SpriteFrameDoc[] = [];

	for (let s = 0; s < sectionStarts.length; s++) {
		const { idx, name } = sectionStarts[s];
		if (seen.has(name)) {
			report('error', `duplicate frame section '${name}'`, { frame: name });
			continue;
		}
		seen.add(name);

		if (!FRAME_NAME_RE.test(name)) {
			report('error', `invalid frame name '${name}'`, { frame: name });
		}

		const contentEnd =
			s + 1 < sectionStarts.length ? sectionStarts[s + 1].idx : lines.length;
		const content = lines.slice(idx + 1, contentEnd);
		const split = splitSection(content);

		if (split.duplicateColors) {
			report('error', '@colors appears more than once in this section', {
				frame: name,
			});
		}
		if (split.duplicateBg) {
			report('error', '@bg appears more than once in this section', {
				frame: name,
			});
		}

		const artRaw = gridFromLines(split.artLines);
		const h = artRaw.length;
		const w = h > 0 ? artRaw[0].length : 0;
		if (h === 0 || w === 0) {
			report('error', `empty frame '${name}'`, { frame: name });
			continue;
		}
		const artRows = artRaw.map((row) =>
			Array.from(row, (ch) => (ch === SENTINEL || ch === ' ' ? ' ' : ch)).join(
				'',
			),
		);

		// Colors grid.
		let colorsGrid: string[] | null = null;
		if (split.colorsLines !== null) {
			const raw = gridFromLines(split.colorsLines);
			const ch = raw.length;
			const cw = ch > 0 ? raw[0].length : 0;
			if (ch !== h || cw !== w) {
				report(
					'error',
					`@colors grid dimensions (${cw}x${ch}) do not match art (${w}x${h})`,
					{ frame: name },
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
							frame: name,
							cell: { x, y },
						});
					}
					rowOut += finalKey;
				} else {
					if (!isBlank) {
						report('warning', `color key on transparent cell '${raw}'`, {
							frame: name,
							cell: { x, y },
						});
					}
					rowOut += ' ';
				}
			}
			colorRows.push(rowOut);
		}

		// Bg grid.
		let bgGrid: string[] | null = null;
		if (split.bgLines !== null) {
			const raw = gridFromLines(split.bgLines);
			const bh = raw.length;
			const bw = bh > 0 ? raw[0].length : 0;
			if (bh !== h || bw !== w) {
				report(
					'error',
					`@bg grid dimensions (${bw}x${bh}) do not match art (${w}x${h})`,
					{ frame: name },
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
							frame: name,
							cell: { x, y },
						});
					}
					rowOut += raw;
				} else {
					report(
						'error',
						`bg key on transparent cell (${x},${y}) is inexpressible`,
						{ frame: name, cell: { x, y } },
					);
					rowOut += ' ';
				}
			}
			bgRows.push(rowOut);
		}

		frames.push({
			name,
			rows: artRows,
			colors: colorRows,
			bg: bgRows,
			anchors: {},
		});
	}

	if (frames.length === 0) {
		report('error', 'no valid frame sections');
		return { doc: null, diagnostics };
	}

	const frameNames = new Set(frames.map((f) => f.name));

	// Resolve frame anchor overrides from the header `frames` field.
	const overridesByFrame = new Map<string, Record<string, SpriteAnchor>>();
	for (const [name, entry] of Object.entries(header.frameOverrides)) {
		if (!frameNames.has(name)) {
			report('warning', `'frames' override for missing frame '${name}'`, {
				frame: name,
			});
			continue;
		}
		for (const anchorName of Object.keys(entry.anchors)) {
			if (!(anchorName in header.anchors)) {
				report('warning', `override of undeclared anchor '${anchorName}'`, {
					frame: name,
				});
			}
		}
		overridesByFrame.set(name, entry.anchors);
	}

	const finalFrames: SpriteFrameDoc[] = frames.map((f) => {
		const overrides = overridesByFrame.get(f.name) ?? {};
		return { ...f, anchors: overrides };
	});

	// Anchor bounds check (effective = file-level merged with frame overrides).
	for (const f of finalFrames) {
		const effective = { ...header.anchors, ...f.anchors };
		const h = f.rows.length;
		const w = h > 0 ? f.rows[0].length : 0;
		for (const [anchorName, a] of Object.entries(effective)) {
			// Anchors are offsets and may be any integer; a value outside the art
			// bounds (either direction) is still worth a typo-guard warning, but a
			// grip-style anchor on a weapon legitimately trips it.
			if (a.x < 0 || a.y < 0 || a.x >= w || a.y >= h) {
				report('warning', `anchor '${anchorName}' out of bounds`, {
					frame: f.name,
					cell: { x: a.x, y: a.y },
				});
			}
		}
	}

	// Animation resolution: explicit animations (filtered against real frames), then
	// implicit single-frame animations for every frame not consumed by an
	// explicit animation (by name or by reference).
	const explicitAnimations: Record<string, string[]> = {};
	for (const [animationName, list] of Object.entries(
		header.explicitAnimations,
	)) {
		const filtered: string[] = [];
		for (const frameName of list) {
			if (frameNames.has(frameName)) {
				filtered.push(frameName);
			} else {
				report(
					'error',
					`animation '${animationName}' references missing frame '${frameName}'`,
				);
			}
		}
		if (filtered.length > 0) explicitAnimations[animationName] = filtered;
	}

	const excluded = new Set<string>();
	for (const [animationName, list] of Object.entries(explicitAnimations)) {
		excluded.add(animationName);
		for (const frameName of list) excluded.add(frameName);
	}

	const animations: Record<string, readonly string[]> = {
		...explicitAnimations,
	};
	for (const f of finalFrames) {
		if (!excluded.has(f.name)) animations[f.name] = [f.name];
	}

	const fps: Record<string, number> = {};
	for (const [animationName, v] of Object.entries(header.fpsRaw)) {
		if (animationName in animations) {
			fps[animationName] = v;
		} else {
			report('warning', `fps for unknown animation '${animationName}'`);
		}
	}

	const doc: SpriteDoc = {
		id,
		key: header.key,
		baseline: header.baseline,
		...(header.accent !== undefined ? { accent: header.accent } : {}),
		anchors: header.anchors,
		animations,
		fps,
		colors: header.colors,
		frames: finalFrames,
	};

	return { doc, diagnostics };
}

function toGlyphRow(row: string): string {
	return row.replaceAll(' ', SENTINEL);
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
	const explicitAnimations = Object.fromEntries(
		Object.entries(doc.animations).filter(
			([name, list]) => !(list.length === 1 && list[0] === name),
		),
	);
	if (Object.keys(explicitAnimations).length > 0)
		header.animations = explicitAnimations;
	if (Object.keys(doc.fps).length > 0) header.fps = doc.fps;
	if (Object.keys(doc.colors).length > 0) {
		header.colors = Object.fromEntries(
			Object.entries(doc.colors).map(([k, q]) => [k, [q[0], q[1], q[2], q[3]]]),
		);
	}
	const frameOverrides = Object.fromEntries(
		doc.frames
			.filter((f) => Object.keys(f.anchors).length > 0)
			.map((f) => [
				f.name,
				{
					anchors: Object.fromEntries(
						Object.entries(f.anchors).map(([n, a]) => [n, [a.x, a.y]]),
					),
				},
			]),
	);
	if (Object.keys(frameOverrides).length > 0) header.frames = frameOverrides;

	const lines: string[] = [];
	if (Object.keys(header).length > 0) {
		lines.push(...JSON.stringify(header, null, '\t').split('\n'));
	}

	for (const frame of doc.frames) {
		lines.push(`--- ${frame.name}`);
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
	}

	return `${lines.join('\n')}\n`;
}
