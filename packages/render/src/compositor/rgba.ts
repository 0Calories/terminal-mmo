/**
 * An 8-bit RGBA colour: each channel is an integer in [0, 255]. Alpha 0 is
 * fully transparent; alpha 255 is fully opaque. This is the compositor's own
 * concrete colour model — it does not depend on OpenTUI's float RGBA.
 */
export type RGBA = readonly [r: number, g: number, b: number, a: number];

/** A caller-owned RGBA the compositor writes into on the allocation-light path. */
export type MutableRGBA = [r: number, g: number, b: number, a: number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export function rgba(r: number, g: number, b: number, a = 255): RGBA {
	return [r, g, b, a];
}

export function equalRGBA(x: RGBA, y: RGBA): boolean {
	return x[0] === y[0] && x[1] === y[1] && x[2] === y[2] && x[3] === y[3];
}

/**
 * Deterministic lexicographic ordering over (r, g, b, a). Resolves every final
 * colour tie in composition so identical inputs always yield identical cells.
 */
export function compareRGBA(x: RGBA, y: RGBA): number {
	if (x[0] !== y[0]) return x[0] - y[0];
	if (x[1] !== y[1]) return x[1] - y[1];
	if (x[2] !== y[2]) return x[2] - y[2];
	return x[3] - y[3];
}

export function sqDistRGB(x: RGBA, y: RGBA): number {
	const dr = x[0] - y[0];
	const dg = x[1] - y[1];
	const db = x[2] - y[2];
	return dr * dr + dg * dg + db * db;
}

/**
 * Plain 8-bit sRGB source-over composite of `src` onto `dst` (no linear-light or
 * perceptual conversion). Opaque source replaces; transparent source is
 * identity; translucent source blends with deterministic rounding.
 */
export function compositeOver(src: RGBA, dst: RGBA): RGBA {
	const sa = src[3];
	if (sa === 255) return [src[0], src[1], src[2], 255];
	if (sa === 0) return [dst[0], dst[1], dst[2], dst[3]];

	const sA = sa / 255;
	const dA = dst[3] / 255;
	const outA = sA + dA * (1 - sA);
	if (outA === 0) return [0, 0, 0, 0];

	const blend = (s: number, d: number): number =>
		Math.round((s * sA + d * dA * (1 - sA)) / outA);
	return [
		blend(src[0], dst[0]),
		blend(src[1], dst[1]),
		blend(src[2], dst[2]),
		Math.round(outA * 255),
	];
}

/**
 * Allocation-light {@link compositeOver}: writes the source-over result into the
 * caller's `out` (never allocates). Byte-identical to `compositeOver`, so it is
 * the hot-path encode form. `out` may alias `src` — each channel reads its own
 * index before writing it.
 */
export function compositeOverInto(
	src: RGBA,
	dst: RGBA,
	out: MutableRGBA,
): void {
	const sa = src[3];
	if (sa === 255) {
		out[0] = src[0];
		out[1] = src[1];
		out[2] = src[2];
		out[3] = 255;
		return;
	}
	if (sa === 0) {
		out[0] = dst[0];
		out[1] = dst[1];
		out[2] = dst[2];
		out[3] = dst[3];
		return;
	}

	const sA = sa / 255;
	const dA = dst[3] / 255;
	const outA = sA + dA * (1 - sA);
	if (outA === 0) {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
		return;
	}

	const blend = (s: number, d: number): number =>
		Math.round((s * sA + d * dA * (1 - sA)) / outA);
	out[0] = blend(src[0], dst[0]);
	out[1] = blend(src[1], dst[1]);
	out[2] = blend(src[2], dst[2]);
	out[3] = Math.round(outA * 255);
}
