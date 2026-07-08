import { Sprite } from '../sprite';
import type { WeaponSprite } from '../weapon-sprite';

// The default Warrior Sword (ADR 0018). All frames anchor the grip at row 2 so the blade
// pivots around a fixed hand; the `·` SENTINEL marks padding cells that keep leading/
// trailing rows from being trimmed, preserving the grip row across differing frame heights.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.

// Blade cells carry the accent key (`a`); the guard keeps its authored key (ADR 0018 §6).
const idle = new Sprite(
	`
▐▌
▟▙
▝▘`,
	{ defaultKey: 'a', colors: `\naa\naa\nkk` },
);

const windup = new Sprite(
	`
·▙
·▐▙
··▝▘
`,
	{
		defaultKey: 'a',
		colors: `
·a
·aa
··kk
`,
	},
);

// Active sweep sampled by swingProgress: heft comes from the phase DURATIONS, not from
// more frames (ADR 0018 §4).
const active1 = new Sprite(
	`
·
▂▙▂▂▂
▔▛▔▔▔
·
`,
	{
		defaultKey: 'a',
		colors: `
·
kaaaa
kaaaa
·
`,
	},
);

export const sword: WeaponSprite = {
	frames: { idle, windup, active: [active1] },
	// The guard cell sits in the hand, grip-to-grip; row 2 in every frame (ADR 0018 §3).
	grip: { x: -1, y: 2 },
	// Steel — the rarity-ready accent channel (today a hand-authored colour key).
	accent: 's',
};
