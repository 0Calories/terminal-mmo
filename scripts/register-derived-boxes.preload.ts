// Tests run under the same derived monster/NPC logical boxes the game
// registers at asset load, so per-file suites agree whatever order they run
// in. Laws about the registry itself clear it and restore what they need.
import {
	loadAssetEntries,
	registerDerivedBoxes,
} from '../packages/assets/src/index';

registerDerivedBoxes(loadAssetEntries());
