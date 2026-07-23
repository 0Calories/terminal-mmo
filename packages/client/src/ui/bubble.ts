import { displayColumns, segmentGraphemes } from '@mmo/render/sprites';

export function bubbleTtl(len: number): number {
	return Math.max(3, Math.min(7, 2 + 0.05 * len));
}

export const BUBBLE_COLS = 22;

/** Terminal columns a word occupies, summed over its grapheme clusters. */
function wordColumns(word: string): number {
	let cols = 0;
	for (const g of segmentGraphemes(word)) cols += displayColumns(g);
	return cols;
}

/**
 * Take a column-bounded prefix of a word without splitting a two-column grapheme
 * across the boundary. Always makes progress: a single grapheme wider than the
 * budget still advances by that whole grapheme.
 */
function takeColumns(
	word: string,
	maxCols: number,
): { head: string; rest: string } {
	let head = '';
	let cols = 0;
	for (const g of segmentGraphemes(word)) {
		const w = displayColumns(g);
		if (head !== '' && cols + w > maxCols) break;
		head += g;
		cols += w;
		if (cols >= maxCols) break;
	}
	return { head, rest: word.slice(head.length) };
}

/**
 * Word-wrap Chat text to a bounded number of displayed columns (ADR 0038: bubbles
 * wrap by terminal display columns, not string length). A wide grapheme counts as
 * two columns and never splits across lines.
 */
export function layoutBubble(text: string, maxCols = BUBBLE_COLS): string[] {
	const lines: string[] = [];
	let cur = '';
	let curCols = 0;
	for (const raw of text.split(/\s+/).filter(Boolean)) {
		let word = raw;
		while (wordColumns(word) > maxCols) {
			if (cur) {
				lines.push(cur);
				cur = '';
				curCols = 0;
			}
			const { head, rest } = takeColumns(word, maxCols);
			lines.push(head);
			word = rest;
		}
		const wordCols = wordColumns(word);
		if (!cur) {
			cur = word;
			curCols = wordCols;
		} else if (curCols + 1 + wordCols <= maxCols) {
			cur += ` ${word}`;
			curCols += 1 + wordCols;
		} else {
			lines.push(cur);
			cur = word;
			curCols = wordCols;
		}
	}
	if (cur) lines.push(cur);
	return lines.length ? lines : [''];
}
