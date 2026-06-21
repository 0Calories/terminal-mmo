// Client-side snapshot interpolation (ADR 0006; PRD cadence). The server streams
// authoritative Zone snapshots at ~20 Hz; rendering co-present entities straight
// from the latest one makes them teleport tick-to-tick. Instead we buffer recent
// snapshots and render everyone EXCEPT the own (locally-predicted) Avatar a fixed
// `INTERP_DELAY_MS` in the past, linearly interpolating between the two snapshots
// that bracket that render time. Pure and deterministic: the caller supplies all
// timestamps, so the buffer never reads a clock itself.

import type { ServerMessage } from '@mmo/shared';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

// Render others ~100 ms behind real time, enough to always have a newer snapshot
// to interpolate toward at a 20 Hz (50 ms) tick (PRD cadence decision).
export const INTERP_DELAY_MS = 100;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

// Interpolate the moving entities of two bracketing snapshots toward the newer
// one. The roster follows `newer` (the latest authoritative view): each of its
// avatars is eased from its position in `older` if it was present there, else
// shown at the newer position (just joined). Non-positional and private state
// (vitals, facing, projectiles, progress, log) is taken from `newer` as-is.
function lerpSnapshot(
	older: Snapshot,
	newer: Snapshot,
	alpha: number,
): Snapshot {
	const prevAvatar = new Map(older.avatars.map((a) => [a.sessionId, a]));
	const avatars = newer.avatars.map((a) => {
		const prev = prevAvatar.get(a.sessionId);
		if (!prev) return a;
		return { ...a, x: lerp(prev.x, a.x, alpha), y: lerp(prev.y, a.y, alpha) };
	});
	const prevMonster = new Map(older.monsters.map((m) => [m.id, m]));
	const monsters = newer.monsters.map((m) => {
		const prev = prevMonster.get(m.id);
		if (!prev) return m;
		return { ...m, x: lerp(prev.x, m.x, alpha), y: lerp(prev.y, m.y, alpha) };
	});
	return { ...newer, avatars, monsters };
}

// Retain ~1 s of history — comfortably more than the interp delay plus any
// realistic jitter — so the bracketing frames are always present while the
// buffer stays bounded across an arbitrarily long session.
const MAX_HISTORY_MS = 1000;

export class SnapshotBuffer {
	private frames: { snap: Snapshot; t: number }[] = [];

	// Number of retained snapshots; bounded by pruning (see MAX_HISTORY_MS).
	get size(): number {
		return this.frames.length;
	}

	push(snap: Snapshot, recvTimeMs: number): void {
		this.frames.push({ snap, t: recvTimeMs });
		// Drop frames older than the history window, but always keep the two most
		// recent so a bracketing pair (and the clamp ends) survive sparse pushes.
		const cutoff = recvTimeMs - MAX_HISTORY_MS;
		let keepFrom = 0;
		while (
			keepFrom < this.frames.length - 2 &&
			this.frames[keepFrom].t < cutoff
		)
			keepFrom++;
		if (keepFrom > 0) this.frames = this.frames.slice(keepFrom);
	}

	// The interpolated Zone view at `renderTimeMs`, shaped exactly like a real
	// snapshot so it flows through the existing render path unchanged. Null until
	// the first snapshot arrives. Outside the buffered range it clamps to the
	// nearest end — we never extrapolate, which would overshoot moving entities.
	sample(renderTimeMs: number): Snapshot | null {
		const frames = this.frames;
		if (frames.length === 0) return null;
		if (renderTimeMs <= frames[0].t) return frames[0].snap;
		const last = frames[frames.length - 1];
		if (renderTimeMs >= last.t) return last.snap;

		for (let i = 0; i < frames.length - 1; i++) {
			const a = frames[i];
			const b = frames[i + 1];
			if (renderTimeMs >= a.t && renderTimeMs < b.t) {
				const span = b.t - a.t;
				const alpha = span > 0 ? (renderTimeMs - a.t) / span : 1;
				return lerpSnapshot(a.snap, b.snap, alpha);
			}
		}
		return last.snap;
	}
}
