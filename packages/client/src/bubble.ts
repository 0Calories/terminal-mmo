export function bubbleTtl(len: number): number {
	return Math.max(3, Math.min(7, 2 + 0.05 * len));
}

export const BUBBLE_COLS = 22;

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
