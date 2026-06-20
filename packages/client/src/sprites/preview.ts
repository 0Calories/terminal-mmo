// Sprite design preview — renders every candidate in gallery.ts in true colour,
// both facings side by side, grouped by entity. It's a plain stdout/ANSI dump:
// no renderer, no TTY, no game loop — just run it and look.
//
//     bun packages/client/src/sprites/preview.ts
//
// Colours come from the real PALETTE, so what you see is what the game draws
// (modulo state tints like the hurt flash, which live in the renderer). Both
// facings are shown so the block-glyph mirror support is visible at a glance.
import { GALLERY, type GalleryEntry } from './gallery';
import { PALETTE } from './palette';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const MISSING: [number, number, number] = [120, 120, 120]; // unknown palette key

/** Glyph rows for one facing, each cell wrapped in its palette colour. */
function paint(sprite: GalleryEntry['sprite'], facing: 1 | -1): string[] {
	const glyphs = sprite.rows(facing);
	const keys = sprite.colorKeys(facing);
	return glyphs.map((row, y) => {
		let out = '';
		for (let x = 0; x < row.length; x++) {
			const ch = row[x];
			if (ch === ' ') {
				out += ' '; // transparent cell
				continue;
			}
			const rgba = PALETTE[keys[y][x]];
			const [r, g, b] = rgba ? rgba.toInts() : MISSING;
			out += `${fg(r, g, b)}${ch}${RESET}`;
		}
		return out;
	});
}

function legend(): string {
	const swatches = Object.entries(PALETTE).map(([k, c]) => {
		const [r, g, b] = c.toInts();
		return `${fg(r, g, b)}██${RESET}${DIM}${k}${RESET}`;
	});
	return `palette  ${swatches.join('  ')}`;
}

console.log(
	`\n${BOLD}Sprite design gallery${RESET}   ${DIM}★ = current recommendation${RESET}`,
);
console.log(legend());

let category = '';
for (const entry of GALLERY) {
	if (entry.category !== category) {
		category = entry.category;
		console.log(`\n${BOLD}━━━━━ ${category} ━━━━━${RESET}`);
	}
	const right = paint(entry.sprite, 1);
	const left = paint(entry.sprite, -1);
	const gap = entry.sprite.w + 6; // visible width of the right block + spacing
	console.log(
		`\n  ${BOLD}${entry.label}${RESET}  ${DIM}${entry.note}  [${entry.sprite.w}×${entry.sprite.h}]${RESET}`,
	);
	console.log(`  ${DIM}${'facing →'.padEnd(gap)}facing ←${RESET}`);
	const h = Math.max(right.length, left.length);
	for (let i = 0; i < h; i++) {
		const r = (right[i] ?? '').padEnd(0); // already exactly sprite.w visible chars
		const l = left[i] ?? '';
		console.log(`  ${r}${' '.repeat(6)}${l}`);
	}
}

console.log('');
