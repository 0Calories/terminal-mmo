// Speech bubble helpers (#59, ADR 0007). The over-head bubble itself is drawn on
// the imperative playfield (rendering is manual per the PRD), but its lifetime and
// text layout are pure functions kept here so they're unit-testable without a
// renderer.

// Bubble lifetime in seconds: a floor so even a one-word line lingers, scaled by
// length, capped so a long line doesn't hang around. `clamp(2 + 0.05·len, 3, 7)`.
export function bubbleTtl(len: number): number {
	return Math.max(3, Math.min(7, 2 + 0.05 * len));
}

// Interior text width a bubble wraps at (~22 cols, ADR 0007).
export const BUBBLE_COLS = 22;

// Word-wrap `text` to lines no wider than `maxCols`; a word longer than a line is
// hard-split across rows. Always returns at least one (possibly empty) line.
export function layoutBubble(text: string, maxCols = BUBBLE_COLS): string[] {
	const lines: string[] = [];
	let cur = '';
	for (const raw of text.split(/\s+/).filter(Boolean)) {
		let word = raw;
		// Drain any overflow beyond a single line into its own full rows.
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
