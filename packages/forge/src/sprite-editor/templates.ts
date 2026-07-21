// Fresh-`.sprite` templates per Sprite role (ADR 0031). Each role gets the
// frames and anchors its validation profile will require, on a small
// sentinel-filled (fully transparent) canvas — a blank slate the editor grows
// as the artist paints. The templates parse cleanly (no diagnostics) so a
// just-created sprite is immediately valid.
import type { RGBAQuad } from '@mmo/core/entities';
import type {
	SpriteAnimationDoc,
	SpriteDoc,
	SpriteFrameDoc,
} from '@mmo/render';

export type SpriteRole = 'form' | 'weapon' | 'hat' | 'monster' | 'npc';

const CANVAS_W = 6;
const CANVAS_H = 4;
const DEFAULT_KEY = 'p';

function blankFrame(): SpriteFrameDoc {
	const rows = Array.from({ length: CANVAS_H }, () => ' '.repeat(CANVAS_W));
	return { rows, colors: rows.slice(), bg: rows.slice(), anchors: {} };
}

interface RoleTemplate {
	// Ordered animations, each with its frame count; the first is the Default
	// frame's owner (ADR 0037), so forms/weapons lead with idle/rest.
	animations: { name: string; frameCount: number }[];
	anchors: Record<string, [number, number]>;
}

// Anchors sit inside the canvas so a fresh template parses without warnings.
const ROLE_TEMPLATES: Record<SpriteRole, RoleTemplate> = {
	form: {
		animations: [
			{ name: 'idle', frameCount: 1 },
			{ name: 'walk', frameCount: 2 },
		],
		anchors: { grip: [4, 2], head: [2, 0] },
	},
	weapon: {
		animations: [
			{ name: 'idle', frameCount: 1 },
			{ name: 'swing', frameCount: 3 },
		],
		anchors: { grip: [1, 2] },
	},
	hat: { animations: [{ name: 'idle', frameCount: 1 }], anchors: {} },
	monster: { animations: [{ name: 'idle', frameCount: 1 }], anchors: {} },
	npc: { animations: [{ name: 'idle', frameCount: 1 }], anchors: {} },
};

export function emptySpriteDoc(id: string, role: SpriteRole): SpriteDoc {
	const template = ROLE_TEMPLATES[role];
	const anchors: Record<string, { x: number; y: number }> = {};
	for (const [name, [x, y]] of Object.entries(template.anchors))
		anchors[name] = { x, y };
	const animations: SpriteAnimationDoc[] = template.animations.map((a) => ({
		name: a.name,
		frames: Array.from({ length: a.frameCount }, blankFrame),
	}));
	return {
		id,
		key: DEFAULT_KEY,
		baseline: 0,
		anchors,
		animations,
		colors: {} as Readonly<Record<string, RGBAQuad>>,
	};
}
