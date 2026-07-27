// PROTOTYPE — throwaway visual harness for Damage numbers (glyph-art floating
// digits). Answers "does this look cool and legible at terminal fidelity?"
// before any real implementation. Not wired into the game loop, `present`, or
// the protocol. Run in a real terminal:
//
//   bun packages/client/prototype/damage-numbers.ts
//
// Keys: 1/2/3 spawn styles, c predicted-hit→break conversion, space overprint
// burst, o overprint policy, e fade (alpha/dissolve/pop), a auto-spawn,
// d drift step, f font height, s emphasis (none/shadow/outline), g font
// gallery, [/] duration, -/= drift distance, q quit.

import { loadSpriteSources } from '@mmo/assets';
import { SCENE_COLORS, SCENE_PALETTE } from '@mmo/core/entities';
import { parseSpriteFile } from '@mmo/render';
import {
	Compositor,
	compositeOver,
	type RGBA,
	rgba,
} from '@mmo/render/compositor';
import {
	type CompiledSprite,
	compileSprite,
	paintSprite,
} from '@mmo/render/sprites';

// ---------------------------------------------------------------------------
// Pixel fonts. Rows top→bottom, 'X' = ink. Small is the handoff's ~2-cells-tall
// target; tall is a 2.5-cell comparison; break is the heavier ~3-row variant.
// ---------------------------------------------------------------------------

const FONT_SMALL: Record<string, readonly string[]> = {
	'0': ['XXX', 'X.X', 'X.X', 'XXX'],
	'1': ['.X.', 'XX.', '.X.', 'XXX'],
	'2': ['XXX', '..X', 'X..', 'XXX'],
	'3': ['XXX', '.XX', '..X', 'XXX'],
	'4': ['X.X', 'X.X', 'XXX', '..X'],
	'5': ['XXX', 'X..', '..X', 'XXX'],
	'6': ['X..', 'XXX', 'X.X', 'XXX'],
	'7': ['XXX', '..X', '.X.', '.X.'],
	// A closed double loop needs 5 rows; open bottom keeps both holes readable.
	'8': ['XXX', 'X.X', 'XXX', 'X.X'],
	'9': ['XXX', 'X.X', 'XXX', '..X'],
};

const FONT_TALL: Record<string, readonly string[]> = {
	'0': ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
	'1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
	'2': ['XXX', '..X', 'XXX', 'X..', 'XXX'],
	'3': ['XXX', '..X', '.XX', '..X', 'XXX'],
	'4': ['X.X', 'X.X', 'XXX', '..X', '..X'],
	'5': ['XXX', 'X..', 'XXX', '..X', 'XXX'],
	'6': ['XXX', 'X..', 'XXX', 'X.X', 'XXX'],
	'7': ['XXX', '..X', '..X', '.X.', '.X.'],
	'8': ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
	'9': ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
};

const FONT_BREAK: Record<string, readonly string[]> = {
	'0': ['.XXX.', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', '.XXX.'],
	'1': ['..XX.', '.XXX.', '..XX.', '..XX.', '..XX.', 'XXXXX'],
	'2': ['.XXX.', 'XX.XX', '...XX', '..XX.', '.XX..', 'XXXXX'],
	'3': ['XXXX.', '...XX', '.XXX.', '...XX', 'XX.XX', '.XXX.'],
	'4': ['XX.XX', 'XX.XX', 'XXXXX', '...XX', '...XX', '...XX'],
	'5': ['XXXXX', 'XX...', 'XXXX.', '...XX', 'XX.XX', '.XXX.'],
	'6': ['.XXXX', 'XX...', 'XXXX.', 'XX.XX', 'XX.XX', '.XXX.'],
	'7': ['XXXXX', '...XX', '..XX.', '..XX.', '.XX..', '.XX..'],
	'8': ['.XXX.', 'XX.XX', '.XXX.', 'XX.XX', 'XX.XX', '.XXX.'],
	'9': ['.XXX.', 'XX.XX', 'XX.XX', '.XXXX', '...XX', 'XXXX.'],
};

// ---------------------------------------------------------------------------
// Styles — palette indices are the tuning knob this prototype exists to turn.
// ---------------------------------------------------------------------------

type Style = 'hit' | 'break' | 'avatar';
type Emphasis = 'none' | 'shadow' | 'outline';
type Overprint = 'free' | 'jitter' | 'stack';

const EMPHASIS_ORDER: readonly Emphasis[] = ['none', 'shadow', 'outline'];
const OVERPRINT_ORDER: readonly Overprint[] = ['free', 'jitter', 'stack'];

/**
 * Deterministic spawn offsets (Pixels) cycled per target so rapid numbers on
 * one spot spread instead of overprinting — every observer sees the same
 * digits at the same place because the cycle is driven by hit order alone.
 */
const JITTER_CYCLE: readonly (readonly [number, number])[] = [
	[0, 0],
	[4, -1],
	[-4, 0],
	[7, 1],
	[-7, -1],
	[2, -2],
];

const STYLE_COLOR: Record<Style, RGBA> = {
	hit: rgba(255, 244, 180),
	break: rgba(255, 150, 40),
	avatar: rgba(255, 84, 70),
};
/** Emphasis rims darker than the fill but well clear of the near-black bg. */
const STYLE_EDGE: Record<Style, RGBA> = {
	hit: rgba(148, 92, 16),
	break: rgba(150, 40, 10),
	avatar: rgba(118, 12, 12),
};

type Fade = 'alpha' | 'dissolve' | 'pop';
const FADE_ORDER: readonly Fade[] = ['alpha', 'dissolve', 'pop'];

/** Ordered-dither thresholds for the dissolve fade (pixels drop, colours don't). */
const BAYER4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
] as const;

// ---------------------------------------------------------------------------
// World layout (cells)
// ---------------------------------------------------------------------------

const W = 72;
const H = 22;
const GROUND_Y = 17;

interface Actor {
	readonly sprite: CompiledSprite;
	readonly x: number;
	readonly facing: 1 | -1;
	readonly label: string;
}

interface DamageNumber {
	value: number;
	style: Style;
	/** Bottom-centre spawn point in sub-cell Pixels. */
	px: number;
	py: number;
	born: number;
	target: Actor;
}

interface Pending {
	at: number;
	run: () => void;
}

// Tunables (live-adjustable)
// Defaults = the user-approved verdict set (2026-07-27).
const knobs = {
	durMs: 600,
	driftCells: 5.5,
	halfCellSteps: true,
	tallFont: true,
	emphasis: 'shadow' as Emphasis,
	overprint: 'jitter' as Overprint,
	fade: 'dissolve' as Fade,
	auto: true,
	gallery: false,
};

const numbers: DamageNumber[] = [];
const scheduled: Pending[] = [];

function loadActorSprite(id: string): CompiledSprite {
	const source = [...loadSpriteSources().values()].find((s) => s.id === id);
	if (!source) throw new Error(`missing sprite ${id}`);
	const { doc } = parseSpriteFile(source.text, source.id);
	if (!doc) throw new Error(`unparsable sprite ${id}`);
	return compileSprite(doc, 'idle');
}

const actors: Actor[] = [
	{ sprite: loadActorSprite('slime'), x: 12, facing: 1, label: 'slime' },
	{ sprite: loadActorSprite('brute'), x: 28, facing: 1, label: 'brute' },
	{ sprite: loadActorSprite('chaser'), x: 44, facing: -1, label: 'chaser' },
	{ sprite: loadActorSprite('buddy'), x: 58, facing: -1, label: 'avatar' },
];

function actorOriginPy(a: Actor): number {
	return (GROUND_Y - a.sprite.heightCells + a.sprite.baseline) * 2;
}

function headPx(a: Actor): { px: number; py: number } {
	return {
		px: a.x * 2 + a.sprite.widthCells,
		py: actorOriginPy(a) - 2,
	};
}

const hitCounts = new Map<Actor, number>();

function spawn(target: Actor, style: Style, value: number): DamageNumber {
	const { px, py } = headPx(target);
	const t = now();
	const n: DamageNumber = { value, style, px, py, born: t, target };
	if (knobs.overprint === 'jitter') {
		const count = hitCounts.get(target) ?? 0;
		hitCounts.set(target, count + 1);
		const [dx, dy] = JITTER_CYCLE[count % JITTER_CYCLE.length];
		n.px += dx;
		n.py += dy;
	} else if (knobs.overprint === 'stack') {
		let minTop = Number.POSITIVE_INFINITY;
		for (const live of numbers) {
			if (live.target === target)
				minTop = Math.min(minTop, numberTopPy(live, t));
		}
		if (Number.isFinite(minTop)) n.py = Math.min(n.py, minTop - 2);
	}
	numbers.push(n);
	return n;
}

function now(): number {
	return performance.now();
}

function randInt(lo: number, hi: number): number {
	return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const comp = new Compositor(W, H);

function drawScene(): void {
	comp.fillPixelRect(0, 0, W * 2, H * 2, SCENE_COLORS.bg);
	comp.fillPixelRect(
		0,
		GROUND_Y * 2,
		W * 2,
		(H - GROUND_Y) * 2,
		SCENE_COLORS.terrainBg,
	);
	comp.fillPixelRect(0, GROUND_Y * 2, W * 2, 1, SCENE_COLORS.terrainFg);
	for (const a of actors) {
		paintSprite(comp, a.sprite, {
			originPx: a.x * 2,
			originPy: actorOriginPy(a),
			facing: a.facing,
			palette: SCENE_PALETTE,
			paletteDefault: SCENE_COLORS.paletteDefault,
		});
	}
}

function fontFor(style: Style): Record<string, readonly string[]> {
	if (style === 'break') return FONT_BREAK;
	return knobs.tallFont ? FONT_TALL : FONT_SMALL;
}

function glyphWidth(font: Record<string, readonly string[]>): number {
	return font['0'][0].length;
}

function glyphHeight(font: Record<string, readonly string[]>): number {
	return font['0'].length;
}

function drawBitmap(
	font: Record<string, readonly string[]>,
	text: string,
	leftPx: number,
	topPy: number,
	color: RGBA,
	keep?: (px: number, py: number) => boolean,
): void {
	const dw = glyphWidth(font);
	let x = leftPx;
	for (const ch of text) {
		const rows = font[ch];
		if (rows) {
			for (let ry = 0; ry < rows.length; ry++) {
				for (let rx = 0; rx < dw; rx++) {
					if (rows[ry][rx] !== 'X') continue;
					if (keep && !keep(x + rx, topPy + ry)) continue;
					comp.setPixel(x + rx, topPy + ry, color);
				}
			}
		}
		x += dw + 1;
	}
}

function numberTopPy(n: DamageNumber, t: number): number {
	const font = fontFor(n.style);
	const progress = Math.min(1, (t - n.born) / knobs.durMs);
	const rawY = n.py - glyphHeight(font) - progress * knobs.driftCells * 2;
	return knobs.halfCellSteps ? Math.round(rawY) : Math.round(rawY / 2) * 2;
}

function drawNumber(n: DamageNumber, t: number): boolean {
	const age = t - n.born;
	if (age >= knobs.durMs) return false;
	const progress = age / knobs.durMs;

	const font = fontFor(n.style);
	const text = String(n.value);
	const dw = glyphWidth(font);
	const widthPx = text.length * (dw + 1) - 1;

	const topPy = numberTopPy(n, t);
	const leftPx = Math.round(n.px - widthPx / 2);

	const fadeStart = 0.65;
	const f =
		progress <= fadeStart ? 0 : (progress - fadeStart) / (1 - fadeStart);
	const alpha = knobs.fade === 'alpha' ? Math.round(255 * (1 - f)) : 255;
	const keep =
		knobs.fade === 'dissolve' && f > 0
			? (px: number, py: number) => BAYER4[py & 3][px & 3] / 16 >= f
			: undefined;
	const base = STYLE_COLOR[n.style];
	const color = rgba(base[0], base[1], base[2], alpha);
	const edgeBase = STYLE_EDGE[n.style];
	const edge = rgba(edgeBase[0], edgeBase[1], edgeBase[2], alpha);

	if (knobs.emphasis === 'shadow') {
		drawBitmap(font, text, leftPx + 1, topPy + 1, edge, keep);
	} else if (knobs.emphasis === 'outline') {
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
			[1, 1],
		] as const) {
			drawBitmap(font, text, leftPx + dx, topPy + dy, edge, keep);
		}
	}
	drawBitmap(font, text, leftPx, topPy, color, keep);
	return true;
}

function drawGallery(): void {
	drawBitmap(FONT_SMALL, '0123456789', 4, 2, STYLE_COLOR.hit);
	drawBitmap(FONT_TALL, '0123456789', 4, 8, STYLE_COLOR.hit);
	drawBitmap(FONT_BREAK, '0123456789', 4, 15, STYLE_COLOR.break);
}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

function opaque(c: RGBA): RGBA {
	if (c[3] === 255) return c;
	return compositeOver(c, SCENE_COLORS.bg);
}

const out = process.stdout;

function renderFrame(t: number): void {
	comp.clear();
	drawScene();
	if (knobs.gallery) drawGallery();
	for (let i = numbers.length - 1; i >= 0; i--) {
		if (!drawNumber(numbers[i], t)) numbers.splice(i, 1);
	}

	const lines: string[] = [];
	for (let cy = 0; cy < H; cy++) {
		let line = '';
		for (let cx = 0; cx < W; cx++) {
			const cell = comp.cell(cx, cy);
			const fg = opaque(cell.fg);
			const bg = opaque(cell.bg);
			line += `\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m${cell.char}`;
		}
		lines.push(`${line}\x1b[0m`);
	}
	const hud = [
		`dur ${knobs.durMs}ms  drift ${knobs.driftCells}c  steps ${
			knobs.halfCellSteps ? 'half-cell' : 'whole-cell'
		}  font ${knobs.tallFont ? 'tall(2.5c)' : 'small(2c)'}  emph ${
			knobs.emphasis
		}  overprint ${knobs.overprint}  fade ${knobs.fade}  auto ${
			knobs.auto ? 'on' : 'off'
		}${knobs.gallery ? '  [GALLERY]' : ''}`,
		'1 hit  2 break  3 avatar  c convert  space burst  o overprint  e fade  a auto  d steps  f font  s emph  g gallery  [ ]=dur∓100ms  - ==drift∓half-cell  q quit',
	];
	out.write(`\x1b[H${lines.join('\r\n')}\r\n\x1b[0m${hud.join('\r\n\x1b[2K')}`);
}

// ---------------------------------------------------------------------------
// Spawning behaviors
// ---------------------------------------------------------------------------

function monster(): Actor {
	return actors[randInt(0, 2)];
}

function spawnConversion(target: Actor): void {
	const n = spawn(target, 'hit', randInt(3, 48));
	scheduled.push({
		at: now() + 150,
		run: () => {
			n.style = 'break';
			n.value += randInt(10, 40);
			n.born = now();
		},
	});
}

function overprintBurst(target: Actor): void {
	const t0 = now();
	for (let i = 0; i < 8; i++) {
		scheduled.push({
			at: t0 + i * 90,
			run: () => {
				spawn(target, i === 5 ? 'break' : 'hit', randInt(3, 48));
			},
		});
	}
}

let autoAt = 0;
let autoCount = 0;

function tick(): void {
	const t = now();
	for (let i = scheduled.length - 1; i >= 0; i--) {
		if (scheduled[i].at <= t) {
			const p = scheduled[i];
			scheduled.splice(i, 1);
			p.run();
		}
	}
	if (knobs.auto && t >= autoAt) {
		autoAt = t + 650;
		autoCount++;
		if (autoCount % 5 === 4) spawnConversion(monster());
		else if (autoCount % 7 === 6) spawn(actors[3], 'avatar', randInt(2, 18));
		else spawn(monster(), 'hit', randInt(3, 48));
	}
	renderFrame(t);
}

// ---------------------------------------------------------------------------
// Input + lifecycle
// ---------------------------------------------------------------------------

function shutdown(): void {
	out.write('\x1b[?7h\x1b[?25h\x1b[?1049l');
	process.exit(0);
}

// Headless spot-check: freeze one mid-flight frame of each style and print the
// glyph grid without colour, then exit. `--dump gallery` prints the font sheet.
if (process.argv.includes('--dump')) {
	knobs.auto = false;
	knobs.gallery = process.argv.includes('gallery');
	const t0 = now();
	if (!knobs.gallery) {
		spawn(actors[0], 'hit', 42);
		spawn(actors[1], 'break', 87);
		spawn(actors[3], 'avatar', 13);
		for (const n of numbers) n.born = t0 - knobs.durMs * 0.3;
	}
	comp.clear();
	drawScene();
	if (knobs.gallery) drawGallery();
	for (const n of numbers) drawNumber(n, t0);
	let grid = '';
	for (let cy = 0; cy < H; cy++) {
		for (let cx = 0; cx < W; cx++) grid += comp.cell(cx, cy).char;
		grid += '\n';
	}
	console.log(grid);
	process.exit(0);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf: Buffer) => {
	const key = buf.toString();
	if (key === 'q' || key === '\x03') shutdown();
	else if (key === '1') spawn(monster(), 'hit', randInt(3, 48));
	else if (key === '2') spawn(monster(), 'break', randInt(20, 99));
	else if (key === '3') spawn(actors[3], 'avatar', randInt(2, 18));
	else if (key === 'c') spawnConversion(monster());
	else if (key === ' ') overprintBurst(actors[1]);
	else if (key === 'a') knobs.auto = !knobs.auto;
	else if (key === 'd') knobs.halfCellSteps = !knobs.halfCellSteps;
	else if (key === 'f') knobs.tallFont = !knobs.tallFont;
	else if (key === 's')
		knobs.emphasis =
			EMPHASIS_ORDER[
				(EMPHASIS_ORDER.indexOf(knobs.emphasis) + 1) % EMPHASIS_ORDER.length
			];
	else if (key === 'o')
		knobs.overprint =
			OVERPRINT_ORDER[
				(OVERPRINT_ORDER.indexOf(knobs.overprint) + 1) % OVERPRINT_ORDER.length
			];
	else if (key === 'e')
		knobs.fade =
			FADE_ORDER[(FADE_ORDER.indexOf(knobs.fade) + 1) % FADE_ORDER.length];
	else if (key === 'g') knobs.gallery = !knobs.gallery;
	else if (key === '[') knobs.durMs = Math.max(300, knobs.durMs - 100);
	else if (key === ']') knobs.durMs = Math.min(1500, knobs.durMs + 100);
	else if (key === '-')
		knobs.driftCells = Math.max(0.5, knobs.driftCells - 0.5);
	else if (key === '=') knobs.driftCells = Math.min(6, knobs.driftCells + 0.5);
});

out.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J');
setInterval(tick, 33);
