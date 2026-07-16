// Run: bun packages/client/src/sprites/cosmetics-preview.ts
import {
	type Cosmetics,
	DEFAULT_FORM_ID,
	type Entity,
	HUES,
	NAMEPLATE_COLORS,
	SCENE_PALETTE,
} from '@mmo/core/entities';
import {
	type CellBuffer,
	drawNameplates,
	HAT_IDS,
	type RenderStyle,
	renderZoneScene,
} from '@mmo/render';

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

const STYLE: RenderStyle<string> = {
	bg: 'bg',
	terrainFg: 't',
	terrainBg: 't',
	portal: 'p',
	transparent: 'tr',
	hurt: 'h',
	nameplate: 'name',
	nameplateBg: 'namebg',
	palette: Object.fromEntries(Object.keys(SCENE_PALETTE).map((k) => [k, k])),
	paletteDefault: '?',
	cosmetics: {
		hues: HUES.map((_, i) => `hue${i}`),
		nameplates: NAMEPLATE_COLORS.map((_, i) => `np${i}`),
		nameplateBgs: NAMEPLATE_COLORS.map((_, i) => `npbg${i}`),
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
	const entities = [avatar(cosmetics)];
	renderZoneScene(
		buf,
		{ terrain, portals: [], npcs: [], entities },
		{ x: 0, y: 0 },
		STYLE,
	);
	drawNameplates(buf, entities, { x: 0, y: 0 }, terrain, STYLE);
	return `${title}\n${buf.toString()}`;
}

console.log(
	'=== Avatar cosmetic hats (#35) — rendered through the shared renderer ===\n',
);
console.log(
	`${frame('[none] None', { hue: 0, hat: '', nameplate: 0, form: DEFAULT_FORM_ID })}\n`,
);
for (const hat of HAT_IDS)
	console.log(
		`${frame(`[${hat}] ${hat}`, { hue: 0, hat, nameplate: 0, form: DEFAULT_FORM_ID })}\n`,
	);

console.log(`=== Hue catalog (${HUES.length}) — body recolour, RGBA ===`);
for (const [i, q] of HUES.entries())
	console.log(`  [${i}] rgb(${q[0]}, ${q[1]}, ${q[2]})`);

console.log(
	`\n=== Nameplate colour catalog (${NAMEPLATE_COLORS.length}) — RGBA ===`,
);
for (const [i, q] of NAMEPLATE_COLORS.entries())
	console.log(`  [${i}] rgb(${q[0]}, ${q[1]}, ${q[2]})`);
