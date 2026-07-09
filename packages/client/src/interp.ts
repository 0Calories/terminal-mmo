import type { ServerMessage } from '@mmo/shared';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

export const INTERP_DELAY_MS = 100;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

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

const MAX_HISTORY_MS = 1000;

export class SnapshotBuffer {
	private frames: { snap: Snapshot; t: number }[] = [];

	get size(): number {
		return this.frames.length;
	}

	push(snap: Snapshot, recvTimeMs: number): void {
		this.frames.push({ snap, t: recvTimeMs });
		// Keep the two most recent even past the window, so a bracketing pair survives sparse pushes.
		const cutoff = recvTimeMs - MAX_HISTORY_MS;
		let keepFrom = 0;
		while (
			keepFrom < this.frames.length - 2 &&
			this.frames[keepFrom].t < cutoff
		)
			keepFrom++;
		if (keepFrom > 0) this.frames = this.frames.slice(keepFrom);
	}

	// Clamps to the nearest end outside the buffered range — never extrapolates.
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
