// Speech bubble helpers (#59, ADR 0007): lifetime and text layout as pure functions,
// unit-testable without a renderer (the bubble itself is drawn on the playfield).

// Lifetime in seconds: a floor so a one-word line still lingers, capped so a long one
// doesn't hang around — clamp(2 + 0.05·len, 3, 7).
export function bubbleTtl(len: number): number {
	return Math.max(3, Math.min(7, 2 + 0.05 * len));
}

// Interior text width a bubble wraps at (~22 cols, ADR 0007).
export const BUBBLE_COLS = 22;

// Word-wrap to `maxCols`; a word longer than a line is hard-split. Always returns at
// least one (possibly empty) line.
export function layoutBubble(text: string, maxCols = BUBBLE_COLS): string[] {
	const lines: string[] = [];
	let cur = '';
	for (const raw of text.split(/\s+/).filter(Boolean)) {
		let word = raw;
		while (word.length > maxCols) {
			if (cur) {
				lines.push(cur);
				cur = '';
			}
			lines.push(word.slice(0, maxCols));
			word = word.slice(maxCols);
		}
		if (!cur) cur = word;
		else if (cur.length + 1 + word.length <= maxCols) cur += ` ${word}`;
		else {
			lines.push(cur);
			cur = word;
		}
	}
	if (cur) lines.push(cur);
	return lines.length ? lines : [''];
}
