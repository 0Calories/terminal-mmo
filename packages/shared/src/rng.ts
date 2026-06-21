// mulberry32. State is threaded explicitly (each call returns value AND next
// state) so loot and spawns stay deterministic / reproducible.

export interface Rng {
	value: number; // in [0, 1)
	state: number;
}

export function rngNext(state: number): Rng {
	const s = (state + 0x6d2b79f5) | 0;
	let t = s;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	return { value, state: s };
}

export function rngInt(state: number, n: number): Rng {
	const r = rngNext(state);
	return { value: Math.floor(r.value * n), state: r.state };
}
