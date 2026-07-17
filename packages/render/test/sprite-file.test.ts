import { expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc, serializeSpriteFile } from '../src';

const RICH = `{
	"key": "e",
	"baseline": 2,
	"anchors": { "grip": [1, 0] },
	"animations": { "wave": ["waveA", "waveB"] },
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
	expect(d.animations).toEqual({ wave: ['waveA', 'waveB'], idle: ['idle'] });
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

test('animations vocabulary: the header key is animations, the doc field is .animations, and legacy poses is unknown', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": { "wave": ["waveA", "waveB"] } }\n--- idle\nAB\n--- waveA\nCD\n--- waveB\nEF\n',
		'anim',
	);
	expect(diagnostics).toEqual([]);
	expect(doc?.animations).toEqual({
		wave: ['waveA', 'waveB'],
		idle: ['idle'],
	});
	expect(serializeSpriteFile(doc as SpriteDoc)).toContain('"animations"');

	// No back-compat alias: a legacy `poses:` key is just an unknown field.
	const legacy = parseSpriteFile('{ "poses": {} }\n--- idle\nAB\n', 'legacy');
	expect(
		legacy.diagnostics.some((d) => d.message.includes('unknown header field')),
	).toBe(true);
});

test('serializer emits canonical animation order: idle, walk, jump, then existing order (ADR 0035)', () => {
	// A doc authored out of order: jump and walk sections before idle.
	const { doc } = parseSpriteFile(
		'{ "animations": { "walk": ["walk-0", "walk-1"] } }\n--- jump\nAB\n--- walk-0\nCD\n--- walk-1\nEF\n--- extra\nGH\n--- idle\nIJ\n',
		'ooo',
	);
	const text = serializeSpriteFile(doc as SpriteDoc);
	const sections = [...text.matchAll(/^--- (\S+)$/gm)].map((m) => m[1]);
	expect(sections).toEqual(['idle', 'walk-0', 'walk-1', 'jump', 'extra']);
	// The canonical file round-trips into canonical frame order.
	const reparsed = parseSpriteFile(text, 'ooo');
	expect(reparsed.doc?.frames.map((f) => f.name)).toEqual(sections);
});

test('serializer emits compact headers: values inline where they fit, arrays always single-line (ADR 0036)', () => {
	// The checked-in buddy header style: anchors inline, long animations map
	// expanded one entry per line, every array single-line.
	const text = `{
	"baseline": 1,
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": {
		"walk": ["walk-0", "walk-1"],
		"emote:wave": ["wave-0", "wave-1"],
		"emote:dance": ["dance-0", "dance-1"]
	}
}
--- idle
AB
--- walk-0
AB
--- walk-1
AB
--- jump
AB
--- wave-0
AB
--- wave-1
AB
--- dance-0
AB
--- dance-1
AB
`;
	const { doc, diagnostics } = parseSpriteFile(text, 'buddy');
	expect(diagnostics).toEqual([]);
	// A save of an untouched doc reproduces the hand-compacted header verbatim.
	expect(serializeSpriteFile(doc as SpriteDoc)).toBe(text);
});

test('serializer omits fps entries equal to the default 5 (ADR 0035)', () => {
	const { doc } = parseSpriteFile(
		'{ "animations": { "walk": ["w0", "w1"] }, "fps": { "walk": 5 } }\n--- idle\nAB\n--- w0\nCD\n--- w1\nEF\n',
		'dflt',
	);
	expect(serializeSpriteFile(doc as SpriteDoc)).not.toContain('"fps"');
	const { doc: fast } = parseSpriteFile(
		'{ "animations": { "walk": ["w0", "w1"] }, "fps": { "walk": 12 } }\n--- idle\nAB\n--- w0\nCD\n--- w1\nEF\n',
		'fast',
	);
	expect(serializeSpriteFile(fast as SpriteDoc)).toContain('"fps"');
});

test('headerless minimal file: defaults, implicit animation, zero diagnostics', () => {
	const { doc, diagnostics } = parseSpriteFile(MINIMAL, 'minimal');
	expect(diagnostics).toEqual([]);
	expect(doc).not.toBeNull();
	const d = doc as SpriteDoc;
	expect(d.key).toBe('p');
	expect(d.baseline).toBe(0);
	expect(d.anchors).toEqual({});
	expect(d.animations).toEqual({ idle: ['idle'] });
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

test('animation referencing missing frame -> error, name removed', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": { "wave": ["idle", "ghost"] } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.animations).toEqual({ wave: ['idle'] });
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /missing frame 'ghost'/.test(d.message),
		),
	).toBe(true);
});

test('animation that empties entirely is dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": { "wave": ["ghost"] } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.animations).toEqual({ idle: ['idle'] });
	expect(diagnostics.some((d) => /missing frame 'ghost'/.test(d.message))).toBe(
		true,
	);
});

test('fps for unknown animation -> warning, dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "fps": { "ghost": 5 } }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.fps).toEqual({});
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'warning' && /fps for unknown animation/.test(d.message),
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

test('negative anchor is accepted as an offset (out-of-bounds warning, not rejected)', () => {
	// A weapon grip legitimately sits one cell left of its art (x = -1). Anchors
	// are offsets, not in-bounds cell references, so the value survives; the
	// out-of-bounds check is a typo-guard warning, not an error.
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [-1, 2] } }\n--- idle\nAB\nCD\nEF\n',
		'x',
	);
	expect(doc?.anchors).toEqual({ grip: { x: -1, y: 2 } });
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
	const warn = diagnostics.find(
		(d) => d.severity === 'warning' && /out of bounds/.test(d.message),
	);
	expect(warn).toBeDefined();
	expect(warn?.cell).toEqual({ x: -1, y: 2 });
});

test('non-integer anchor entry is still rejected as an error', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [0.5, 2], "head": [0, 0] } }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.anchors).toEqual({ head: { x: 0, y: 0 } });
	expect(
		diagnostics.some((d) => d.severity === 'error' && /grip/.test(d.message)),
	).toBe(true);
});

test('accent header field is parsed onto the doc and round-trips', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "accent": "s" }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.accent).toBe('s');
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
	expect(diagnostics.some((d) => /unknown header field/.test(d.message))).toBe(
		false,
	);
	const reparsed = parseSpriteFile(serializeSpriteFile(doc as SpriteDoc), 'x');
	expect(reparsed.doc?.accent).toBe('s');
});

test('invalid accent (multi-char) -> error diagnostic, dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "accent": "sw" }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.accent).toBeUndefined();
	expect(
		diagnostics.some((d) => d.severity === 'error' && /accent/.test(d.message)),
	).toBe(true);
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

test('implicit-animation resolution: frames consumed by explicit animation get no implicit animation', () => {
	const { doc } = parseSpriteFile(
		'{ "animations": { "emote:wave": ["waveA", "waveB"] } }\n--- idle\nAB\n--- waveA\nCD\n--- waveB\nEF\n',
		'x',
	);
	expect(doc?.animations).toEqual({
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
