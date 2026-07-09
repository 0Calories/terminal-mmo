import { expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc, serializeSpriteFile } from '../src';

const RICH = `{
	"key": "e",
	"baseline": 2,
	"anchors": { "grip": [1, 0] },
	"poses": { "wave": ["waveA", "waveB"] },
	"fps": { "wave": 6 },
	"colors": { "q": [10, 20, 30, 255] }
}
--- idle
AB
CD
--- waveA
·A
B·
@colors
·q
e·
@bg
·s
··
--- waveB
XY
ZW
`;

const MINIMAL = `--- idle
AB
CD
`;

test('happy path: rich file parses with zero diagnostics and precise doc fields', () => {
	const { doc, diagnostics } = parseSpriteFile(RICH, 'rich');
	expect(diagnostics).toEqual([]);
	expect(doc).not.toBeNull();
	const d = doc as SpriteDoc;
	expect(d.id).toBe('rich');
	expect(d.key).toBe('e');
	expect(d.baseline).toBe(2);
	expect(d.anchors).toEqual({ grip: { x: 1, y: 0 } });
	expect(d.poses).toEqual({ wave: ['waveA', 'waveB'], idle: ['idle'] });
	expect(d.fps).toEqual({ wave: 6 });
	expect(d.colors).toEqual({ q: [10, 20, 30, 255] });
	expect(d.frames.map((f) => f.name)).toEqual(['idle', 'waveA', 'waveB']);

	const idle = d.frames[0];
	expect(idle.rows).toEqual(['AB', 'CD']);
	expect(idle.colors).toEqual(['ee', 'ee']);
	expect(idle.bg).toEqual(['  ', '  ']);
	expect(idle.anchors).toEqual({});

	const waveA = d.frames[1];
	expect(waveA.rows).toEqual([' A', 'B ']);
	expect(waveA.colors).toEqual([' q', 'e ']);
	expect(waveA.bg).toEqual([' s', '  ']);

	const waveB = d.frames[2];
	expect(waveB.rows).toEqual(['XY', 'ZW']);
	expect(waveB.colors).toEqual(['ee', 'ee']);
	expect(waveB.bg).toEqual(['  ', '  ']);
});

test('headerless minimal file: defaults, implicit pose, zero diagnostics', () => {
	const { doc, diagnostics } = parseSpriteFile(MINIMAL, 'minimal');
	expect(diagnostics).toEqual([]);
	expect(doc).not.toBeNull();
	const d = doc as SpriteDoc;
	expect(d.key).toBe('p');
	expect(d.baseline).toBe(0);
	expect(d.anchors).toEqual({});
	expect(d.poses).toEqual({ idle: ['idle'] });
	expect(d.fps).toEqual({});
	expect(d.colors).toEqual({});
	expect(d.frames).toHaveLength(1);
	expect(d.frames[0].rows).toEqual(['AB', 'CD']);
});

test('round-trip law: rich file', () => {
	const { doc } = parseSpriteFile(RICH, 'rich');
	const d = doc as SpriteDoc;
	const serialized = serializeSpriteFile(d);
	const reparsed = parseSpriteFile(serialized, d.id);
	expect(reparsed.diagnostics).toEqual([]);
	expect(reparsed.doc).toEqual(d);
	const serializedAgain = serializeSpriteFile(reparsed.doc as SpriteDoc);
	expect(serializedAgain).toBe(serialized);
});

test('round-trip law: minimal file', () => {
	const { doc } = parseSpriteFile(MINIMAL, 'minimal');
	const d = doc as SpriteDoc;
	const serialized = serializeSpriteFile(d);
	const reparsed = parseSpriteFile(serialized, d.id);
	expect(reparsed.diagnostics).toEqual([]);
	expect(reparsed.doc).toEqual(d);
	const serializedAgain = serializeSpriteFile(reparsed.doc as SpriteDoc);
	expect(serializedAgain).toBe(serialized);
});

test('never throws: battery of malformed inputs', () => {
	const inputs = [
		'{ this is not json',
		'{]',
		'',
		'{}',
		'no sections here at all',
		'--- a\nAB\n--- a\nCD\n',
		'--- a\nAB\n@colors\nX\n',
		'--- a\n·A\nB·\n@bg\nsq\nqs\n',
		'\x00\x01\x02 binary-ish \xFF text',
	];
	for (const input of inputs) {
		expect(() => parseSpriteFile(input, 'x')).not.toThrow();
	}
});

test('invalid header JSON -> doc null, error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ this is not json\n--- a\nAB\n',
		'x',
	);
	expect(doc).toBeNull();
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /header JSON/.test(d.message),
		),
	).toBe(true);
});

test('header not a JSON object -> doc null, error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile('[1,2,3]\n--- a\nAB\n', 'x');
	expect(doc).toBeNull();
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /must be a JSON object/.test(d.message),
		),
	).toBe(true);
});

test('no valid frame sections -> doc null', () => {
	const { doc, diagnostics } = parseSpriteFile('{}', 'x');
	expect(doc).toBeNull();
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
});

test('empty string -> doc null, no frame sections', () => {
	const { doc } = parseSpriteFile('', 'x');
	expect(doc).toBeNull();
});

test('header id -> error diagnostic, ignored (identity is filename)', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "id": "foo" }\n--- a\nAB\n',
		'the-real-id',
	);
	expect(doc?.id).toBe('the-real-id');
	expect(
		diagnostics.some((d) => d.severity === 'error' && /'id'/.test(d.message)),
	).toBe(true);
});

test('invalid key falls back to "p" with error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "key": "··" }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.key).toBe('p');
	expect(
		diagnostics.some((d) => d.severity === 'error' && /key/.test(d.message)),
	).toBe(true);
});

test('invalid baseline falls back to 0 with error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "baseline": -1 }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.baseline).toBe(0);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /baseline/.test(d.message),
		),
	).toBe(true);
});

test('invalid anchor entry -> error diagnostic, entry skipped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [1], "head": [1, 1] } }\n--- a\nAB\nCD\n',
		'x',
	);
	expect(doc?.anchors).toEqual({ head: { x: 1, y: 1 } });
	expect(
		diagnostics.some((d) => d.severity === 'error' && /grip/.test(d.message)),
	).toBe(true);
});

test('unknown header field -> warning diagnostic, dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "bogus": 1 }\n--- a\nAB\n',
		'x',
	);
	expect(doc).not.toBeNull();
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /bogus/.test(d.message),
		),
	).toBe(true);
});

test('reserved key redefinition (p) -> error, entry skipped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "colors": { "p": [1,2,3,255], "q": [4,5,6,255] } }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.colors).toEqual({ q: [4, 5, 6, 255] });
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /reserved/.test(d.message),
		),
	).toBe(true);
});

test('reserved key redefinition (a) -> error, entry skipped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "colors": { "a": [1,2,3,255] } }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.colors).toEqual({});
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /reserved/.test(d.message),
		),
	).toBe(true);
});

test('unknown color key -> warning diagnostic, kept as-is', () => {
	const { doc, diagnostics } = parseSpriteFile('--- a\nAB\n@colors\nZZ\n', 'x');
	const frame = doc?.frames[0];
	expect(frame?.colors).toEqual(['ZZ']);
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /unknown color key/.test(d.message),
		),
	).toBe(true);
});

test('color key on transparent cell -> warning, stored as space', () => {
	const { doc, diagnostics } = parseSpriteFile('--- a\n·A\n@colors\ne·\n', 'x');
	const frame = doc?.frames[0];
	expect(frame?.rows).toEqual([' A']);
	expect(frame?.colors).toEqual([' p']);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'warning' &&
				/color key on transparent cell/.test(d.message),
		),
	).toBe(true);
});

test('bg on transparent cell -> error, stored as space', () => {
	const { doc, diagnostics } = parseSpriteFile('--- a\n·A\n@bg\ns·\n', 'x');
	const frame = doc?.frames[0];
	expect(frame?.rows).toEqual([' A']);
	expect(frame?.bg).toEqual(['  ']);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' && /bg key on transparent cell/.test(d.message),
		),
	).toBe(true);
});

test('dimension-mismatched @colors grid ignored with error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'--- a\nAB\nCD\n@colors\ne\n',
		'x',
	);
	const frame = doc?.frames[0];
	expect(frame?.colors).toEqual(['pp', 'pp']);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /dimensions/.test(d.message),
		),
	).toBe(true);
});

test('duplicate @colors marker -> error, later grid ignored', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'--- a\nAB\n@colors\nee\n@colors\nqq\n',
		'x',
	);
	const frame = doc?.frames[0];
	expect(frame?.colors).toEqual(['ee']);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' &&
				/@colors appears more than once/.test(d.message),
		),
	).toBe(true);
});

test('pose referencing missing frame -> error, name removed', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "poses": { "wave": ["idle", "ghost"] } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.poses).toEqual({ wave: ['idle'] });
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /missing frame 'ghost'/.test(d.message),
		),
	).toBe(true);
});

test('pose that empties entirely is dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "poses": { "wave": ["ghost"] } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.poses).toEqual({ idle: ['idle'] });
	expect(diagnostics.some((d) => /missing frame 'ghost'/.test(d.message))).toBe(
		true,
	);
});

test('fps for unknown pose -> warning, dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "fps": { "ghost": 5 } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.fps).toEqual({});
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /fps for unknown pose/.test(d.message),
		),
	).toBe(true);
});

test("'frames' override for missing frame -> warning, dropped", () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "frames": { "ghost": { "anchors": { "grip": [0,0] } } } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.frames[0].anchors).toEqual({});
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'warning' &&
				/override for missing frame/.test(d.message),
		),
	).toBe(true);
});

test('override of undeclared anchor -> warning, kept', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "frames": { "idle": { "anchors": { "grip": [0,0] } } } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.frames[0].anchors).toEqual({ grip: { x: 0, y: 0 } });
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /undeclared anchor/.test(d.message),
		),
	).toBe(true);
});

test('anchor out of bounds -> warning', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [9, 9] } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc).not.toBeNull();
	const warn = diagnostics.find(
		(d) => d.severity === 'warning' && /out of bounds/.test(d.message),
	);
	expect(warn).toBeDefined();
	expect(warn?.frame).toBe('idle');
	expect(warn?.cell).toEqual({ x: 9, y: 9 });
});

test('bad frame-name charset -> error diagnostic, still parsed', () => {
	const { doc, diagnostics } = parseSpriteFile('--- weird!name\nAB\n', 'x');
	expect(doc?.frames[0].name).toBe('weird!name');
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /invalid frame name/.test(d.message),
		),
	).toBe(true);
});

test('implicit-pose resolution: frames consumed by explicit pose get no implicit pose', () => {
	const { doc } = parseSpriteFile(
		'{ "poses": { "emote:wave": ["waveA", "waveB"] } }\n--- idle\nAB\n--- waveA\nCD\n--- waveB\nEF\n',
		'x',
	);
	expect(doc?.poses).toEqual({
		idle: ['idle'],
		'emote:wave': ['waveA', 'waveB'],
	});
});

test('diagnostics carry spriteId', () => {
	const { diagnostics } = parseSpriteFile('{}', 'my-sprite-id');
	expect(diagnostics.length).toBeGreaterThan(0);
	for (const d of diagnostics) expect(d.spriteId).toBe('my-sprite-id');
});

test('empty frame (zero rows) -> error diagnostic, frame dropped', () => {
	const { doc, diagnostics } = parseSpriteFile('--- a\n\n--- b\nAB\n', 'x');
	expect(doc?.frames.map((f) => f.name)).toEqual(['b']);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /empty frame 'a'/.test(d.message),
		),
	).toBe(true);
});

test('duplicate frame section -> error, later section ignored', () => {
	const { doc, diagnostics } = parseSpriteFile('--- a\nAB\n--- a\nCD\n', 'x');
	expect(doc?.frames).toHaveLength(1);
	expect(doc?.frames[0].rows).toEqual(['AB']);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' && /duplicate frame section/.test(d.message),
		),
	).toBe(true);
});
