// Fresh-`.sprite` templates per Sprite role (ADR 0031). Each role gets the
// frames and anchors its validation profile will require, on a small
// sentinel-filled (fully transparent) canvas — a blank slate the editor grows
// as the artist paints. The templates parse cleanly (no diagnostics) so a
// just-created sprite is immediately valid.
import type { RGBAQuad } from '@mmo/core/entities';
import type { SpriteDoc, SpriteFrameDoc } from '@mmo/render';

export type SpriteRole = 'form' | 'weapon' | 'hat' | 'monster' | 'npc';

const CANVAS_W = 6;
const CANVAS_H = 4;
const DEFAULT_KEY = 'p';

function blankFrame(name: string): SpriteFrameDoc {
	const rows = Array.from({ length: CANVAS_H }, () => ' '.repeat(CANVAS_W));
	return { name, rows, colors: rows.slice(), bg: rows.slice(), anchors: {} };
}

interface RoleTemplate {
	frames: string[];
	anchors: Record<string, [number, number]>;
}

// Anchors sit inside the canvas so a fresh template parses without warnings.
const ROLE_TEMPLATES: Record<SpriteRole, RoleTemplate> = {
	form: {
		frames: ['idle', 'walkA', 'walkB'],
		anchors: { grip: [4, 2], head: [2, 0] },
	},
	weapon: { frames: ['idle', 'windup', 'active'], anchors: { grip: [1, 2] } },
	hat: { frames: ['idle'], anchors: {} },
	monster: { frames: ['idle'], anchors: {} },
	npc: { frames: ['idle'], anchors: {} },
};

export function emptySpriteDoc(id: string, role: SpriteRole): SpriteDoc {
	const template = ROLE_TEMPLATES[role];
	const anchors: Record<string, { x: number; y: number }> = {};
	for (const [name, [x, y]] of Object.entries(template.anchors))
		anchors[name] = { x, y };
	const frames = template.frames.map(blankFrame);
	const animations: Record<string, readonly string[]> = {};
	for (const f of frames) animations[f.name] = [f.name];
	return {
		id,
		key: DEFAULT_KEY,
		baseline: 0,
		anchors,
		animations,
		fps: {},
		colors: {} as Readonly<Record<string, RGBAQuad>>,
		frames,
	};
}
