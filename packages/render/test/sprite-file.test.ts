import { expect, test } from 'bun:test';
import { parseSpriteFile, type SpriteDoc, serializeSpriteFile } from '../src';

const RICH = `{
	"key": "e",
	"baseline": 2,
	"anchors": { "grip": [1, 0] },
	"animations": [
		{ "name": "idle" },
		{ "name": "wave", "fps": 6, "anchors": { "1": { "grip": [0, 1] } } }
	],
	"colors": { "q": [10, 20, 30, 255] }
}
--- idle
AB
CD
--- wave 0
·A
B·
@colors
·q
e·
@bg
·s
··
--- wave 1
XY
ZW
`;

const MINIMAL = `{ "animations": [{ "name": "idle" }] }
--- idle
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
	expect(d.animations.map((a) => a.name)).toEqual(['idle', 'wave']);
	expect(d.animations[0].fps).toBeUndefined();
	expect(d.animations[1].fps).toBe(6);
	expect(d.animations[1].frames).toHaveLength(2);

	const idle = d.animations[0].frames[0];
	expect(idle.rows).toEqual(['AB', 'CD']);
	expect(idle.colors).toEqual(['ee', 'ee']);
	expect(idle.bg).toEqual(['  ', '  ']);
	expect(idle.anchors).toEqual({});

	const wave0 = d.animations[1].frames[0];
	expect(wave0.rows).toEqual([' A', 'B ']);
	expect(wave0.colors).toEqual([' q', 'e ']);
	expect(wave0.bg).toEqual([' s', '  ']);
	expect(wave0.anchors).toEqual({});

	const wave1 = d.animations[1].frames[1];
	expect(wave1.rows).toEqual(['XY', 'ZW']);

	expect(wave1.anchors).toEqual({ grip: { x: 0, y: 1 } });
});

test('sections bind to declared animations by (animation, index); a single-frame animation omits the index', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "idle" }, { "name": "wave" }] }\n--- idle\nAB\n--- wave 0\nCD\n--- wave 1\nEF\n',
		'anim',
	);
	expect(diagnostics).toEqual([]);
	expect(doc?.animations.map((a) => [a.name, a.frames.length])).toEqual([
		['idle', 1],
		['wave', 2],
	]);
	expect(serializeSpriteFile(doc as SpriteDoc)).toContain('"animations"');
});

test('a section referencing an undeclared animation is a parse error', () => {
	const { diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "idle" }] }\n--- idle\nAB\n--- ghost\nCD\n',
		'x',
	);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' &&
				/undeclared animation 'ghost'/.test(d.message),
		),
	).toBe(true);
});

test('a declared animation with zero sections is a parse error', () => {
	const { diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "idle" }, { "name": "wave" }] }\n--- idle\nAB\n',
		'x',
	);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' &&
				/'wave' has no frame sections/.test(d.message),
		),
	).toBe(true);
});

test('non-contiguous frame indices are a parse error', () => {
	const { diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "walk" }] }\n--- walk 0\nAB\n--- walk 2\nCD\n',
		'x',
	);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' &&
				/non-contiguous frame indices/.test(d.message),
		),
	).toBe(true);
});

test('a multi-section animation with a bare (indexless) section is a parse error', () => {
	const { diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "walk" }] }\n--- walk\nAB\n--- walk 1\nCD\n',
		'x',
	);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /needs an index/.test(d.message),
		),
	).toBe(true);
});

test('serializer emits one line per animation object when the array overflows the budget (ADR 0036/0037)', () => {
	const text = `{
	"baseline": 1,
	"anchors": { "grip": [1, 0], "head": [0, 0] },
	"animations": [
		{ "name": "idle" },
		{ "name": "walk" },
		{ "name": "jump" },
		{ "name": "emote:wave", "fps": 8 }
	]
}
--- idle
AB
--- walk 0
AB
--- walk 1
AB
--- jump
AB
--- emote:wave 0
AB
--- emote:wave 1
AB
`;
	const { doc, diagnostics } = parseSpriteFile(text, 'buddy');
	expect(diagnostics).toEqual([]);

	expect(serializeSpriteFile(doc as SpriteDoc)).toBe(text);
});

test('serializer keeps a short animations array inline (compact discipline, ADR 0036)', () => {
	const text = `{
	"animations": [{ "name": "idle" }, { "name": "swing" }]
}
--- idle
AB
--- swing 0
AB
--- swing 1
AB
--- swing 2
AB
`;
	const { doc, diagnostics } = parseSpriteFile(text, 'sword');
	expect(diagnostics).toEqual([]);
	expect(serializeSpriteFile(doc as SpriteDoc)).toBe(text);
});

test('serializer omits fps entries equal to the default 5 (ADR 0035/0037)', () => {
	const { doc } = parseSpriteFile(
		'{ "animations": [{ "name": "idle" }, { "name": "walk", "fps": 5 }] }\n--- idle\nGH\n--- walk 0\nCD\n--- walk 1\nEF\n',
		'dflt',
	);
	expect(serializeSpriteFile(doc as SpriteDoc)).not.toContain('"fps"');
	const { doc: fast } = parseSpriteFile(
		'{ "animations": [{ "name": "idle" }, { "name": "walk", "fps": 12 }] }\n--- idle\nGH\n--- walk 0\nCD\n--- walk 1\nEF\n',
		'fast',
	);
	expect(serializeSpriteFile(fast as SpriteDoc)).toContain('"fps"');
});

test('minimal file: defaults, one single-frame animation, zero diagnostics', () => {
	const { doc, diagnostics } = parseSpriteFile(MINIMAL, 'minimal');
	expect(diagnostics).toEqual([]);
	expect(doc).not.toBeNull();
	const d = doc as SpriteDoc;
	expect(d.key).toBe('p');
	expect(d.baseline).toBe(0);
	expect(d.anchors).toEqual({});
	expect(d.animations.map((a) => a.name)).toEqual(['idle']);
	expect(d.animations[0].frames).toHaveLength(1);
	expect(d.animations[0].frames[0].rows).toEqual(['AB', 'CD']);
	expect(d.colors).toEqual({});
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

test('no declared animations -> doc null', () => {
	const { doc, diagnostics } = parseSpriteFile('{}', 'x');
	expect(doc).toBeNull();
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
});

test('sections but no header animations -> doc null (every section is undeclared)', () => {
	const { doc, diagnostics } = parseSpriteFile('--- idle\nAB\n', 'x');
	expect(doc).toBeNull();
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /undeclared/.test(d.message),
		),
	).toBe(true);
});

test('empty string -> doc null, no animations', () => {
	const { doc } = parseSpriteFile('', 'x');
	expect(doc).toBeNull();
});

test('header id -> error diagnostic, ignored (identity is filename)', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "id": "foo", "animations": [{ "name": "idle" }] }\n--- idle\nAB\n',
		'the-real-id',
	);
	expect(doc?.id).toBe('the-real-id');
	expect(
		diagnostics.some((d) => d.severity === 'error' && /'id'/.test(d.message)),
	).toBe(true);
});

test('invalid key falls back to "p" with error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "key": "··", "animations": [{ "name": "idle" }] }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.key).toBe('p');
	expect(
		diagnostics.some((d) => d.severity === 'error' && /key/.test(d.message)),
	).toBe(true);
});

test('invalid baseline falls back to 0 with error diagnostic', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "baseline": -1, "animations": [{ "name": "idle" }] }\n--- idle\nAB\n',
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
		'{ "anchors": { "grip": [1], "head": [1, 1] }, "animations": [{ "name": "a" }] }\n--- a\nAB\nCD\n',
		'x',
	);
	expect(doc?.anchors).toEqual({ head: { x: 1, y: 1 } });
	expect(
		diagnostics.some((d) => d.severity === 'error' && /grip/.test(d.message)),
	).toBe(true);
});

test('unknown header field -> warning diagnostic, dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "bogus": 1, "animations": [{ "name": "a" }] }\n--- a\nAB\n',
		'x',
	);
	expect(doc).not.toBeNull();
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /bogus/.test(d.message),
		),
	).toBe(true);
});

test('duplicate animation name -> error, entry skipped', () => {
	const { diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "idle" }, { "name": "idle" }] }\n--- idle\nAB\n',
		'x',
	);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /duplicate animation/.test(d.message),
		),
	).toBe(true);
});

test('reserved key redefinition (p) -> error, entry skipped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "colors": { "p": [1,2,3,255], "q": [4,5,6,255] }, "animations": [{ "name": "a" }] }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.colors).toEqual({ q: [4, 5, 6, 255] });
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /reserved/.test(d.message),
		),
	).toBe(true);
});

test('unknown color key -> warning diagnostic, kept as-is', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "a" }] }\n--- a\nAB\n@colors\nZZ\n',
		'x',
	);
	const frame = doc?.animations[0].frames[0];
	expect(frame?.colors).toEqual(['ZZ']);
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /unknown color key/.test(d.message),
		),
	).toBe(true);
});

test('color key on transparent cell -> warning, stored as space', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "a" }] }\n--- a\n·A\n@colors\ne·\n',
		'x',
	);
	const frame = doc?.animations[0].frames[0];
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
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "a" }] }\n--- a\n·A\n@bg\ns·\n',
		'x',
	);
	const frame = doc?.animations[0].frames[0];
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
		'{ "animations": [{ "name": "a" }] }\n--- a\nAB\nCD\n@colors\ne\n',
		'x',
	);
	const frame = doc?.animations[0].frames[0];
	expect(frame?.colors).toEqual(['pp', 'pp']);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /dimensions/.test(d.message),
		),
	).toBe(true);
});

test('duplicate @colors marker -> error, later grid ignored', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "a" }] }\n--- a\nAB\n@colors\nee\n@colors\nqq\n',
		'x',
	);
	const frame = doc?.animations[0].frames[0];
	expect(frame?.colors).toEqual(['ee']);
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' &&
				/@colors appears more than once/.test(d.message),
		),
	).toBe(true);
});

test('per-index anchor override for a missing frame index -> warning', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [0,0] }, "animations": [{ "name": "idle", "anchors": { "3": { "grip": [0,0] } } }] }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.animations[0].frames[0].anchors).toEqual({});
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'warning' &&
				/anchor override for missing frame index 3/.test(d.message),
		),
	).toBe(true);
});

test('override of undeclared anchor -> warning, kept', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "idle", "anchors": { "0": { "grip": [0,0] } } }] }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.animations[0].frames[0].anchors).toEqual({
		grip: { x: 0, y: 0 },
	});
	expect(
		diagnostics.some(
			(d) => d.severity === 'warning' && /undeclared anchor/.test(d.message),
		),
	).toBe(true);
});

test('anchor out of bounds -> warning, located at its section label', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [9, 9] }, "animations": [{ "name": "idle" }] }\n--- idle\nAB\n',
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
	const { doc, diagnostics } = parseSpriteFile(
		'{ "anchors": { "grip": [-1, 2] }, "animations": [{ "name": "idle" }] }\n--- idle\nAB\nCD\nEF\n',
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
		'{ "anchors": { "grip": [0.5, 2], "head": [0, 0] }, "animations": [{ "name": "a" }] }\n--- a\nAB\n',
		'x',
	);
	expect(doc?.anchors).toEqual({ head: { x: 0, y: 0 } });
	expect(
		diagnostics.some((d) => d.severity === 'error' && /grip/.test(d.message)),
	).toBe(true);
});

test('accent header field is parsed onto the doc and round-trips', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "accent": "s", "animations": [{ "name": "idle" }] }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.accent).toBe('s');
	expect(diagnostics.some((d) => d.severity === 'error')).toBe(false);
	const reparsed = parseSpriteFile(serializeSpriteFile(doc as SpriteDoc), 'x');
	expect(reparsed.doc?.accent).toBe('s');
});

test('invalid accent (multi-char) -> error diagnostic, dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "accent": "sw", "animations": [{ "name": "idle" }] }\n--- idle\nAB\n',
		'x',
	);
	expect(doc?.accent).toBeUndefined();
	expect(
		diagnostics.some((d) => d.severity === 'error' && /accent/.test(d.message)),
	).toBe(true);
});

test('invalid animation name -> error diagnostic, entry skipped', () => {
	const { diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "weird!name" }] }\n--- idle\nAB\n',
		'x',
	);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /invalid animation name/.test(d.message),
		),
	).toBe(true);
});

test('diagnostics carry spriteId', () => {
	const { diagnostics } = parseSpriteFile('{}', 'my-sprite-id');
	expect(diagnostics.length).toBeGreaterThan(0);
	for (const d of diagnostics) expect(d.spriteId).toBe('my-sprite-id');
});

test('empty frame (zero rows) -> error diagnostic, animation dropped', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "a" }, { "name": "b" }] }\n--- a\n\n--- b\nAB\n',
		'x',
	);
	expect(doc?.animations.map((animation) => animation.name)).toEqual(['b']);
	expect(
		diagnostics.some(
			(d) => d.severity === 'error' && /empty frame 'a'/.test(d.message),
		),
	).toBe(true);
});

test('duplicate frame index -> error, later section ignored', () => {
	const { doc, diagnostics } = parseSpriteFile(
		'{ "animations": [{ "name": "walk" }] }\n--- walk 0\nAB\n--- walk 0\nCD\n',
		'x',
	);

	expect(doc).toBeNull();
	expect(
		diagnostics.some(
			(d) =>
				d.severity === 'error' && /duplicate frame 'walk 0'/.test(d.message),
		),
	).toBe(true);
});
