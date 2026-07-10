// physics — deterministic movement integration and terrain collision queries.

export {
	DEFAULT_MASS,
	PHYS,
} from './constants';
export {
	applyImpulse,
	stepEntity,
} from './physics';
export {
	CELL,
	cellGlyph,
	isSolid,
	isWall,
	parseTerrain,
	terrainCell,
} from './terrain';
