// progression — XP/levels, capability unlocks, and meter-fill math.

export {
	clamp01,
	filledCells,
	fillRatio,
} from './bars';
export {
	MONSTER_XP,
	PROGRESSION,
	ZONE_XP_MULT,
} from './constants';
export {
	applyXp,
	CAPABILITY_UNLOCK,
	type Capability,
	capabilityUnlocked,
	maxHpForLevel,
	type XpProgress,
	xpForKill,
	xpProgress,
	xpToNext,
} from './progression';
