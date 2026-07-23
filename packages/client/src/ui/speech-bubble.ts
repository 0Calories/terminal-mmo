import { BOX, type Entity } from '@mmo/core/entities';
import { spriteFor } from '@mmo/render';
import type { Compositor, RGBA } from '@mmo/render/compositor';
import { COLORS as C } from '../theme';
import { layoutBubble } from './bubble';

const BUBBLE_FG: RGBA = C.bubbleFg.toInts();
const BUBBLE_BORDER: RGBA = C.bubbleBorder.toInts();
// Translucent frost (alpha 128) laid over the composed scene, and the opaque
// `▒` shade for empty interior cells. Both read as the same frosted tone over
// terrain (ADR 0016).
const BUBBLE_BG: RGBA = C.bubbleBg.toInts();
const BUBBLE_SHADE: RGBA = C.bubbleShade.toInts();

type BoxCell = { ch: string; fg: RGBA } | null;

interface BoxContent {
	w: number;
	h: number;
	cell(x: number, y: number): BoxCell;
}

function textContent(lines: readonly string[], fg: RGBA): BoxContent {
	return {
		w: Math.max(1, ...lines.map((l) => l.length)),
		h: lines.length,
		cell(x, y) {
			const ch = lines[y]?.[x];
			return ch && ch !== ' ' ? { ch, fg } : null;
		},
	};
}

function drawOverheadBox(
	compositor: Compositor,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
	content: BoxContent,
	border: RGBA,
) {
	const sprite = spriteFor(e.type);
	const top = Math.round(e.y + BOX.h - sprite.h - cam.y);
	const boxW = content.w + 2;
	const boxH = content.h + 2;

	const cx = e.x + BOX.w / 2 - cam.x;
	const tailY = top - 2;
	const tailX = Math.round(cx);
	const topY = tailY - boxH;
	let left = Math.round(cx - boxW / 2);
	left = Math.max(0, Math.min(left, sw - boxW));

	for (let ry = 0; ry < boxH; ry++) {
		const py = topY + ry;
		if (py < 0 || py >= sh) continue;
		const lastRow = ry === boxH - 1;
		for (let rx = 0; rx < boxW; rx++) {
			const px = left + rx;
			if (px < 0 || px >= sw) continue;
			const lastCol = rx === boxW - 1;
			const isBorder = ry === 0 || lastRow || rx === 0 || lastCol;
			if (isBorder) {
				let ch = '│';
				if (ry === 0) ch = rx === 0 ? '╭' : lastCol ? '╮' : '─';
				else if (lastRow) ch = rx === 0 ? '╰' : lastCol ? '╯' : '─';
				compositor.stampGlyph(px, py, ch, border);
				continue;
			}
			const c = content.cell(rx - 1, ry - 1);
			if (c) {
				// Frost the interior as translucent sub-cell pixels over the composed
				// scene, then stamp the glyph so it derives that frosted backdrop —
				// ADR 0016's look composed against the real pixels (ADR 0038), never a
				// sampled-terrain guess.
				compositor.fillPixelRect(px * 2, py * 2, 2, 2, BUBBLE_BG);
				compositor.stampGlyph(px, py, c.ch, c.fg);
			} else {
				compositor.stampGlyph(px, py, '▒', BUBBLE_SHADE);
			}
		}
	}
	if (tailY >= 0 && tailY < sh && tailX >= 0 && tailX < sw)
		compositor.stampGlyph(tailX, tailY, '▼', border);
}

export function drawSpeechBubble(
	compositor: Compositor,
	e: Entity,
	cam: { x: number; y: number },
	sw: number,
	sh: number,
) {
	if (!e.bubble) return;
	const content = textContent(layoutBubble(e.bubble), BUBBLE_FG);
	drawOverheadBox(compositor, e, cam, sw, sh, content, BUBBLE_BORDER);
}
