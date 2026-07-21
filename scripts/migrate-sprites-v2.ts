// One-time migration: `.sprite` format v1 → v2 (ADR 0037). Rewrites every
// `sprites/**/*.sprite` in place, committed alongside the parser cutover.
//
// v1: the header's `animations` was a map name→frame-name[], with a top-level
// `fps` map and a top-level `frames` per-frame-name anchor-override map; a frame
// referenced by no animation was an IMPLICIT single-frame animation named after
// the frame. v2: `animations` is an ordered array of `{ name, fps?, anchors? }`
// (anchors keyed by frame INDEX), frames are unnamed and bound by `--- <animation>
// <index>` sections, and every animation is explicit.
//
// Strategy: parse the v1 header + sections, replicate v1's animation resolution
// (explicit + implicit) in the OLD serializer's canonical order (idle, walk, jump
// lead, then existing order), emit that as parseable v2 text with each frame's
// body carried VERBATIM (so art is byte-identical), then parse+re-serialize it
// through the v2 codec so the committed files land in canonical form.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpriteFile, serializeSpriteFile } from '../packages/render/src';

const SPRITES_DIR = join(import.meta.dir, '..', 'sprites');
const CANONICAL_LEADS = ['idle', 'walk', 'jump'];

interface V1Header {
	key?: string;
	baseline?: number;
	accent?: string;
	anchors?: Record<string, [number, number]>;
	animations?: Record<string, string[]>;
	fps?: Record<string, number>;
	colors?: Record<string, [number, number, number, number]>;
	frames?: Record<string, { anchors?: Record<string, [number, number]> }>;
}

const SECTION_RE = /^---\s+(\S+)\s*$/;

// Split a v1 file into (header JSON text, [{ name, body }] sections in order).
function splitV1(text: string): {
	header: V1Header;
	sections: { name: string; body: string[] }[];
} {
	const lines = text.split('\n');
	let firstSection = lines.length;
	for (let i = 0; i < lines.length; i++)
		if (SECTION_RE.test(lines[i])) {
			firstSection = i;
			break;
		}
	const headerText = lines.slice(0, firstSection).join('\n').trim();
	const header: V1Header = headerText === '' ? {} : JSON.parse(headerText);

	const sections: { name: string; body: string[] }[] = [];
	let cur: { name: string; body: string[] } | null = null;
	for (let i = firstSection; i < lines.length; i++) {
		const m = SECTION_RE.exec(lines[i]);
		if (m) {
			cur = { name: m[1], body: [] };
			sections.push(cur);
		} else if (cur) {
			cur.body.push(lines[i]);
		}
	}
	// Trim a trailing blank line off each body (the final newline).
	for (const s of sections)
		while (s.body.length > 0 && s.body[s.body.length - 1].trim() === '')
			s.body.pop();
	return { header, sections };
}

// Replicate v1 animation resolution: explicit animations (filtered to real
// frames), then implicit single-frame animations for every unconsumed frame — in
// the OLD serializer's canonical order.
function resolveAnimations(
	header: V1Header,
	sections: { name: string; body: string[] }[],
): { name: string; frames: string[] }[] {
	const frameNames = new Set(sections.map((s) => s.name));
	const explicit: Record<string, string[]> = {};
	for (const [name, list] of Object.entries(header.animations ?? {})) {
		const filtered = list.filter((f) => frameNames.has(f));
		if (filtered.length > 0) explicit[name] = filtered;
	}
	const excluded = new Set<string>();
	for (const [name, list] of Object.entries(explicit)) {
		excluded.add(name);
		for (const f of list) excluded.add(f);
	}
	// v1 doc.animations insertion order: explicit (header order) then implicit
	// (section order).
	const ordered: { name: string; frames: string[] }[] = [];
	for (const [name, list] of Object.entries(explicit))
		ordered.push({ name, frames: list });
	for (const s of sections)
		if (!excluded.has(s.name)) ordered.push({ name: s.name, frames: [s.name] });

	// Canonical order: idle, walk, jump lead; then the rest keep their order.
	const leads = CANONICAL_LEADS.filter((n) =>
		ordered.some((a) => a.name === n),
	);
	const rest = ordered.filter((a) => !leads.includes(a.name));
	return [
		...leads.map(
			(n) =>
				ordered.find((a) => a.name === n) as { name: string; frames: string[] },
		),
		...rest,
	];
}

function migrate(text: string, id: string): string {
	const { header, sections } = splitV1(text);
	const bodyOf = new Map(sections.map((s) => [s.name, s.body]));
	const animations = resolveAnimations(header, sections);

	// Build a parseable v2 header + relabeled sections (bodies verbatim).
	const v2Animations = animations.map((a) => {
		const entry: Record<string, unknown> = { name: a.name };
		if (header.fps?.[a.name] !== undefined) entry.fps = header.fps[a.name];
		const overrides: Record<string, unknown> = {};
		a.frames.forEach((frameName, i) => {
			const ov = header.frames?.[frameName]?.anchors;
			if (ov && Object.keys(ov).length > 0) overrides[String(i)] = ov;
		});
		if (Object.keys(overrides).length > 0) entry.anchors = overrides;
		return entry;
	});

	const v2Header: Record<string, unknown> = {};
	if (header.key !== undefined) v2Header.key = header.key;
	if (header.baseline !== undefined) v2Header.baseline = header.baseline;
	if (header.accent !== undefined) v2Header.accent = header.accent;
	if (header.anchors !== undefined) v2Header.anchors = header.anchors;
	v2Header.animations = v2Animations;
	if (header.colors !== undefined) v2Header.colors = header.colors;

	const out: string[] = [JSON.stringify(v2Header, null, '\t')];
	for (const a of animations) {
		const single = a.frames.length === 1;
		a.frames.forEach((frameName, i) => {
			out.push(single ? `--- ${a.name}` : `--- ${a.name} ${i}`);
			const body = bodyOf.get(frameName) ?? [];
			out.push(...body);
		});
	}
	const v2Text = `${out.join('\n')}\n`;

	// Canonicalize through the v2 codec (and prove it parses clean).
	const { doc, diagnostics } = parseSpriteFile(v2Text, id);
	if (doc === null)
		throw new Error(
			`migration produced unparseable v2 for '${id}': ${JSON.stringify(diagnostics)}`,
		);
	const errors = diagnostics.filter((d) => d.severity === 'error');
	if (errors.length > 0)
		throw new Error(
			`migration produced v2 parse errors for '${id}': ${JSON.stringify(errors)}`,
		);
	return serializeSpriteFile(doc);
}

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(p));
		else if (entry.name.endsWith('.sprite')) out.push(p);
	}
	return out;
}

function main(): void {
	const files = walk(SPRITES_DIR).sort();
	for (const path of files) {
		const id = path.replace(/^.*\//, '').replace(/\.sprite$/, '');
		const before = readFileSync(path, 'utf8');
		const after = migrate(before, id);
		writeFileSync(path, after);
		console.log(`migrated ${path}`);
	}
	console.log(`\n${files.length} files migrated.`);
}

main();
