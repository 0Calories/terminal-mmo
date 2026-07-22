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
	animations: { name: string; frameCount: number }[];
	anchors: Record<string, [number, number]>;
}

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
