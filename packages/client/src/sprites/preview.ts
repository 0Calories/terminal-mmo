// Sprite design preview — renders every candidate in `gallery.ts` in true
// colour, both facings side by side, grouped by entity kind. It's a plain
// stdout/ANSI dump: no renderer, no TTY, no game loop — just run it and look.
//
//     bun packages/client/src/sprites/preview.ts
//
// Colours come from the real PALETTE, so what you see is what the game would
// draw (modulo state tints like the hurt flash, which live in the renderer).
// Both facings are shown so the block-glyph mirror support is visible at a
// glance.
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

/** Right-facing and left-facing renders laid side by side, with the label and
 *  note printed to the right of the art. */
function card(entry: GalleryEntry): string {
	const right = paint(entry.sprite, 1);
	const left = paint(entry.sprite, -1);
	const h = Math.max(right.length, left.length);
	const colW = entry.sprite.w;
	const glyphRight = entry.sprite.rows(1);
	const lines: string[] = [];
	for (let y = 0; y < h; y++) {
		const r = right[y] ?? '';
		const l = left[y] ?? '';
		// Pad the right-facing block to colW visible cells; ANSI colour codes
		// carry no width, so pad by the sprite's known glyph-cell width.
		const rVisible = (glyphRight[y] ?? '').length;
		const rGap = ' '.repeat(Math.max(0, colW - rVisible));
		lines.push(`  ${r}${rGap}   ${l}`);
	}
	// Attach the label/note to the middle line.
	const mid = Math.floor(h / 2);
	const meta = `${BOLD}${entry.label}${RESET}  ${DIM}${entry.note}${RESET}`;
	lines[mid] = `${lines[mid]}    ${meta}`;
	return lines.join('\n');
}

function legend(): string {
	const swatches = Object.entries(PALETTE).map(([k, c]) => {
		const [r, g, b] = c.toInts();
		return `${fg(r, g, b)}██${RESET}${DIM}${k}${RESET}`;
	});
	return `${DIM}palette${RESET}  ${swatches.join('  ')}`;
}

console.log(
	`\n${BOLD}Sprite design gallery${RESET}   ${DIM}each shown right-facing │ left-facing${RESET}`,
);
console.log(legend());

let category = '';
for (const entry of GALLERY) {
	if (entry.category !== category) {
		category = entry.category;
		console.log(`\n${BOLD}━━━━━ ${category} ━━━━━${RESET}\n`);
	}
	console.log(card(entry));
	console.log();
}
