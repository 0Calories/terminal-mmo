import { PHYS } from '../../../physics/constants';
import { isSolid } from '../../../physics/terrain';
import type { Entity, Facing, Terrain } from '../../types';
import type { EngineMemory, EngineStep, MovementEngine } from '../shared';
import { footProbe, toward, wallAhead } from '../shared';

export type HopCadence = 'patrol' | 'approach';

export interface HopShape {
	/** Ticks the gait rests after an exertion, per cadence. */
	rest: Record<HopCadence, number>;

	/** Horizontal speed scale of a full hop. */
	speed: number;

	/** Jump impulse scale: hops ride flatter arcs than a full jump. */
	jump: number;
}

export interface HopMemory {
	kind: 'hop';

	restT: number;

	/** Which cadence the rest paces — only an approach rest paces a chase. */
	cadence: HopCadence;

	/** Horizontal scale of the hop in flight, set by the drive that launched it. */
	hopScale?: number;
}

interface HopStep extends EngineStep {
	memory: HopMemory;
}

const IDLE: HopMemory = { kind: 'hop', restT: 0, cadence: 'patrol' };

function hopMemory(memory: EngineMemory | undefined): HopMemory {
	return memory?.kind === 'hop' ? memory : IDLE;
}

/** Contiguous solid ground ahead of the leading foot, capped at one full hop. */
function groundAhead(m: Entity, t: Terrain, dir: Facing, span: number): number {
	const { lead, footY } = footProbe(m, dir);
	let cols = 0;
	while (cols < span && isSolid(t, lead + dir * (cols + 1), footY)) cols++;
	return cols;
}

/**
 * Leaping gait: no step is ever a walk. Hops are separated by a rest, scaled to
 * the ground that can catch them, and hold the scale they launched with until
 * they land.
 */
export function hopEngine(shape: HopShape): MovementEngine {
	// Columns a full hop carries the monster (scaled speed × ballistic airtime of
	// the scaled jump), plus one for the drift of the landing tick.
	const span = (m: Entity) =>
		Math.ceil(
			(m.speed * shape.speed * 2 * PHYS.jump * shape.jump) / PHYS.grav,
		) + 1;

	const inFlight = (m: Entity, memory: HopMemory): HopStep => ({
		drive: { moveX: m.facing, jump: false, moveScale: memory.hopScale ?? 1 },
		memory,
	});

	const rest = (memory: HopMemory): HopStep => ({
		drive: { moveX: 0, jump: false },
		memory: { ...memory, restT: memory.restT - 1 },
	});

	const launch = (
		moveX: Facing | 0,
		hopScale: number,
		cadence: HopCadence,
	): HopStep => ({
		drive: { moveX, jump: true, moveScale: hopScale, jumpScale: shape.jump },
		memory: { kind: 'hop', restT: shape.rest[cadence], cadence, hopScale },
	});

	return {
		wander: (m, view, memory) => {
			const mem = hopMemory(memory);
			if (!m.onGround) return inFlight(m, mem);
			if (mem.restT > 0) return rest(mem);

			const t = view.terrain;
			const reach = span(m);
			const room = (dir: Facing) =>
				wallAhead(m, t, dir) ? 0 : groundAhead(m, t, dir, reach);
			const ahead = room(m.facing);
			const dir: Facing = ahead > 0 ? m.facing : m.facing === 1 ? -1 : 1;
			const cols = ahead > 0 ? ahead : room(dir);
			return launch(cols > 0 ? dir : 0, (shape.speed * cols) / reach, 'patrol');
		},

		moveToward: (m, _view, destX, memory) => {
			const mem = hopMemory(memory);
			if (!m.onGround) return inFlight(m, mem);
			if (mem.restT > 0 && mem.cadence === 'approach') return rest(mem);

			const dx = destX - m.x;
			const want = Math.abs(dx);
			if (want === 0)
				return {
					drive: { moveX: 0, jump: false },
					memory: {
						...mem,
						restT: shape.rest.approach,
						cadence: 'approach',
					},
				};
			return launch(
				toward(dx),
				shape.speed * Math.min(1, want / span(m)),
				'approach',
			);
		},
	};
}
