// Headless preview of the Avatar cosmetic catalog (#35), rendered through the SAME
// shared renderer the game uses (drawEntitySprite / renderZoneScene) — no TTY — so
// the hat anchoring, body recolour, and nameplate placement shown here are exactly
// what ships. Run: bun packages/client/src/sprites/cosmetics-preview.ts
import {
	type CellBuffer,
	type Cosmetics,
	type Entity,
	HATS,
	HUES,
	NAMEPLATE_COLORS,
	type RenderStyle,
	renderZoneScene,
	SCENE_PALETTE,
} from '@mmo/shared';

// A text CellBuffer: records glyphs into a grid so we can print the result. Colours
// are recorded too but printed as a separate legend (a terminal dump is glyph-only).
class TextBuffer implements CellBuffer<string> {
	readonly width: number;
	readonly height: number;
	grid: string[][];
	constructor(w: number, h: number) {
		this.width = w;
		this.height = h;
		this.grid = Array.from({ length: h }, () =>
			Array.from({ length: w }, () => ' '),
		);
	}
	clear(): void {
		for (const row of this.grid) row.fill(' ');
	}
	setCell(x: number, y: number, ch: string): void {
		if (x >= 0 && x < this.width && y >= 0 && y < this.height)
			this.grid[y][x] = ch;
	}
	setCellWithAlphaBlending(x: number, y: number, ch: string): void {
		this.setCell(x, y, ch);
	}
	toString(): string {
		return this.grid.map((r) => r.join('').replace(/\s+$/, '')).join('\n');
	}
}

// A glyph-only style: every palette key maps to itself (irrelevant for a glyph dump).
const STYLE: RenderStyle<string> = {
	bg: 'bg',
	terrainFg: 't',
	terrainBg: 't',
	portal: 'p',
	transparent: 'tr',
	hurt: 'h',
	nameplate: 'name',
	nameplateWash: 'wash',
	palette: Object.fromEntries(Object.keys(SCENE_PALETTE).map((k) => [k, k])),
	paletteDefault: '?',
	cosmetics: {
		hues: HUES.map((_, i) => `hue${i}`),
		nameplates: NAMEPLATE_COLORS.map((_, i) => `np${i}`),
		nameplateWashes: NAMEPLATE_COLORS.map((_, i) => `wash${i}`),
	},
};

function avatar(cosmetics: Cosmetics): Entity {
	return {
		id: 1,
		type: 'player',
		name: 'neo',
		cosmetics,
		x: 7,
		y: 3,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
	};
}

function frame(title: string, cosmetics: Cosmetics): string {
	const buf = new TextBuffer(16, 11);
	const terrain = { w: 16, h: 11, cells: new Uint8Array(16 * 11) };
	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities: [avatar(cosmetics)] },
		{ x: 0, y: 0 },
		STYLE,
	);
	return `${title}\n${buf.toString()}`;
}

console.log(
	'=== Avatar cosmetic hats (#35) — rendered through the shared renderer ===\n',
);
for (let hat = 0; hat < HATS.length; hat++)
	console.log(
		`${frame(`[${hat}] ${HATS[hat].name}`, { hue: 0, hat, nameplate: 0, form: 0 })}\n`,
	);

console.log(`=== Hue catalog (${HUES.length}) — body recolour, RGBA ===`);
for (const [i, q] of HUES.entries())
	console.log(`  [${i}] rgb(${q[0]}, ${q[1]}, ${q[2]})`);

console.log(
	`\n=== Nameplate colour catalog (${NAMEPLATE_COLORS.length}) — RGBA ===`,
);
for (const [i, q] of NAMEPLATE_COLORS.entries())
	console.log(`  [${i}] rgb(${q[0]}, ${q[1]}, ${q[2]})`);
