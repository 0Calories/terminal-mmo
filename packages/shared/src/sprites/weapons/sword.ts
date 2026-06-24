import { Sprite } from '../sprite';
import type { WeaponSprite } from '../weapon-sprite';

// The default Warrior Sword's appearance (ADR 0018). A held one-hander posed at the
// hand at all times: an upright steel blade at rest, raised on wind-up, sweeping
// down through the active strike, and trailing low on recovery. Authored right-facing;
// the renderer mirrors the art (and the grip column) when the Avatar faces left.
//
// All frames anchor the GRIP at row index 2 (the hand), so the blade pivots around a
// fixed hand as it swings — wind-up reaches above the hand, recovery hangs below it.
// `·` (SENTINEL) marks a transparent padding cell; it keeps a frame's leading/trailing
// rows from being trimmed away, preserving the grip row across frames of differing height.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.

// Rest: blade upright at the side, steel rising from a dark guard (the hand cell).
const idle = new Sprite(
	`
▐▌
▟▙
▝▘`,
	{ defaultKey: 's', colors: `\nss\nss\nkk` },
);

// Wind-up: blade cocked up-and-forward, raised to strike (above the hand).
const windup = new Sprite(
	`
·▙
·▐▙
··▝▘
`,
	{
		defaultKey: 's',
		colors: `
·s
·ss
··kk
`,
	},
);

// Active sweep (ADR 0018 §4): a fixed-length ordered arc the renderer samples by
// swingProgress — first frame at 0, last at 1. The blade rotates around the hand from
// high (up-forward) through a level strike to low (down-forward); heft comes from the
// weapon's phase DURATIONS, not from more frames.

// ▃▅▁▁▁▁
// ▔▀▔▔▔▔

// ▃▙▂▂▂▂
//  ▘▔▔▔▔

const active1 = new Sprite(
	`
·
▂▙▂▂▂
▔▛▔▔▔
·
`,
	{
		defaultKey: 's',
		colors: `
·
kssss
kssss
·
`,
	},
);

export const sword: WeaponSprite = {
	frames: { idle, windup, active: [active1] },
	// Bottom-of-rest cell (the guard) sits in the hand: grip-to-grip with the body grip,
	// row 2 in every frame so the blade pivots around a fixed hand through the swing.
	grip: { x: -1, y: 2 },
	// Steel — the rarity-ready accent channel (today a hand-authored colour key).
	accent: 's',
};
