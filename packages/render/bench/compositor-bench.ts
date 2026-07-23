/**
 * OPT-IN compositor performance harness (ADR 0038: "Performance and
 * verification"). Times composition + the allocation-light read/flatten encode
 * for a representative viewport (~4 ms target) and a crowded stress scene (many
 * actors + particles). It is NOT wired into `bun test`: CI timing is noisy, so
 * this only reports numbers and never asserts a threshold.
 *
 *   bun run packages/render/bench/compositor-bench.ts
 *
 * Optional env: MMO_BENCH_ITERS (frames per case, default 400).
 *
 * The encode step mirrors the client/forge adapters (`readCellInto` +
 * `compositeOverInto` into reused scratch) but drops OpenTUI's `setCell`, which
 * is environment-dependent and outside the compositor's control — so the number
 * reflects the compositor cost this package owns.
 */
import { type Entity, spawnMonster, type Terrain } from '@mmo/core/entities';
import {
	Compositor,
	compositeOverInto,
	createCellOut,
	type MutableRGBA,
	type RGBA,
} from '../src/compositor';
import { drawNameplates, drawProjectiles, drawTerrain } from '../src/scene';
import { paintActor } from '../src/sprites';

const SCENE_BG: RGBA = [16, 18, 26, 255];
const ITERS = Number(process.env.MMO_BENCH_ITERS) || 400;
const cam = { x: 0, y: 0 };

function ground(w: number, h: number): Terrain {
	const cells = new Uint8Array(w * h);
	for (let x = 0; x < w; x++) {
		cells[(h - 1) * w + x] = 1;
		cells[(h - 2) * w + x] = 1;
	}
	// A couple of floating platforms for depth.
	for (let x = 4; x < w - 4; x += 11) {
		for (let dx = 0; dx < 6 && x + dx < w; dx++)
			cells[(h - 6) * w + x + dx] = 1;
	}
	return { w, h, cells };
}

function crowd(w: number, h: number, count: number): Entity[] {
	const types = ['chaser', 'brute', 'shooter'] as const;
	const out: Entity[] = [];
	for (let i = 0; i < count; i++) {
		const type = types[i % types.length];
		const x = 2 + ((i * 7) % Math.max(1, w - 6));
		const y = h - 3 - ((i * 3) % 4);
		const e = spawnMonster(type, i + 1, x, y);
		e.onGround = true;
		e.facing = i % 2 === 0 ? 1 : -1;
		e.name = `mob-${i}`;
		out.push(e);
	}
	return out;
}

function projectiles(w: number, h: number, count: number) {
	const out = [];
	for (let i = 0; i < count; i++) {
		out.push({
			x: (i * 5) % w,
			y: (i * 2) % (h - 3),
			vx: i % 2 === 0 ? 3 : -3,
			vy: 0,
		});
	}
	return out;
}

/** Scatter translucent sub-cell "particles" across the viewport. */
function particles(c: Compositor, count: number): void {
	const subW = c.widthCells * 2;
	const subH = c.heightCells * 2;
	for (let i = 0; i < count; i++) {
		const px = (i * 13) % subW;
		const py = (i * 7) % subH;
		const a = 90 + ((i * 37) % 150);
		c.setPixel(px, py, [
			(i * 53) % 256,
			(i * 97) % 256,
			(i * 29) % 256,
			a,
		] as RGBA);
	}
}

function compose(
	c: Compositor,
	terrain: Terrain,
	mobs: Entity[],
	projs: ReturnType<typeof projectiles>,
	particleCount: number,
): void {
	c.clear();
	drawTerrain(c, terrain, cam);
	for (const e of mobs) paintActor(c, e, cam);
	drawProjectiles(c, projs, cam, [255, 120, 80, 255]);
	particles(c, particleCount);
	drawNameplates(c, mobs, cam);
}

/** Mirror the production encode read path without OpenTUI. Returns a checksum. */
function encode(c: Compositor): number {
	const out = createCellOut();
	const fg: MutableRGBA = [0, 0, 0, 0];
	let sum = 0;
	for (let y = 0; y < c.heightCells; y++) {
		for (let x = 0; x < c.widthCells; x++) {
			c.readCellInto(x, y, out);
			if (out.bg[3] !== 255) compositeOverInto(out.bg, SCENE_BG, out.bg);
			compositeOverInto(out.fg, out.bg, fg);
			sum += out.char.charCodeAt(0) + fg[0] + out.bg[0] + (out.wide ? 1 : 0);
		}
	}
	return sum;
}

interface Case {
	label: string;
	w: number;
	h: number;
	mobs: number;
	projectiles: number;
	particles: number;
}

function run(cse: Case): void {
	const c = new Compositor(cse.w, cse.h);
	const terrain = ground(cse.w, cse.h);
	const mobs = crowd(cse.w, cse.h, cse.mobs);
	const projs = projectiles(cse.w, cse.h, cse.projectiles);

	// Warm up JIT.
	for (let i = 0; i < 30; i++) {
		compose(c, terrain, mobs, projs, cse.particles);
		encode(c);
	}

	let checksum = 0;
	const t0 = performance.now();
	for (let i = 0; i < ITERS; i++) {
		compose(c, terrain, mobs, projs, cse.particles);
		checksum += encode(c);
	}
	const total = performance.now() - t0;
	const per = total / ITERS;
	const fps = 1000 / per;
	const cells = cse.w * cse.h;
	console.log(
		`${cse.label.padEnd(22)} ${cse.w}x${cse.h} (${cells} cells, ${cse.mobs} mobs, ${cse.particles} particles): ` +
			`${per.toFixed(3)} ms/frame  ~${fps.toFixed(0)} FPS  [checksum ${checksum % 1000}]`,
	);
}

console.log(
	`compositor bench — ${ITERS} frames/case (compose + read/flatten encode, no OpenTUI)\n`,
);
run({
	label: 'representative',
	w: 80,
	h: 24,
	mobs: 8,
	projectiles: 6,
	particles: 60,
});
run({
	label: 'wide viewport',
	w: 120,
	h: 40,
	mobs: 16,
	projectiles: 12,
	particles: 120,
});
run({
	label: 'crowded stress',
	w: 120,
	h: 40,
	mobs: 60,
	projectiles: 40,
	particles: 600,
});
