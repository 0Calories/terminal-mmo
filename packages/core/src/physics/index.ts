// physics — the single owner of terrain-collision truth: solidity queries and
// the bidirectional sweep, under two integrators (the Momentum-body step and
// the projectile step). Owns the Drive and MomentumBody views (ADR 0032).

export {
	DEFAULT_MASS,
	PHYS,
} from './constants';
export {
	type AbilityId,
	applyImpulse,
	type Drive,
	IDLE_DRIVE,
	type ImpulseBody,
	type MomentumBody,
	stepEntity,
} from './physics';
export {
	type PointBody,
	stepProjectile,
} from './projectile';
export {
	type SweepHit,
	sweepPoint,
} from './sweep';
export {
	CELL,
	cellGlyph,
	isSolid,
	isWall,
	parseTerrain,
	terrainCell,
} from './terrain';
