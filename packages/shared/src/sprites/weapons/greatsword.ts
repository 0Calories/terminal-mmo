import { Sprite } from '../sprite';
import type { WeaponSprite } from '../weapon-sprite';

// The Greatsword's appearance (ADR 0018, #184). A long two-hander that reads HEAVY
// at rest — a tall broad blade rising from a wide crossguard, much longer than the
// one-hand Sword. Authored right-facing; the renderer mirrors the art (and the grip
// column) when the Avatar faces left.
//
// Every frame is a fixed 5×5 canvas anchoring the GRIP (the hand) at the same cell
// (col 2, row 4), so the blade pivots around a fixed hand through the swing — a
// single grip serves every frame of the WeaponSprite. `·` (SENTINEL) marks a
// transparent padding cell, keeping leading/trailing rows from being trimmed so the
// grip row stays aligned frame to frame.
//
// The same fixed-length active sweep as every weapon: heft comes ENTIRELY from the
// Greatsword's long phase DURATIONS (its stat block), NOT from extra frames — so this
// sweep plays slow and ponderous where the Dagger's identical-length sweep flicks.
//
// Blade cells carry the dynamic ACCENT key (`a`, ADR 0018 §6) so the whole blade, its
// blade-edge arc and its Trail read in the weapon's one accent colour (cyan here) and
// re-tint with rarity later; the crossguard and grip keep their authored keys.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.

// Rest: a long blade upright over a wide crossguard, grip in the hand below.
const idle = new Sprite(
	`
··█··
··█··
··█··
·▟█▙·
··█··`,
	{
		defaultKey: 'a',
		colors: `
··a··
··a··
··a··
·kak·
··k··`,
	},
);

// Wind-up: the heavy blade hauled up-and-back, cocked for the overhead chop.
const windup = new Sprite(
	`
█···
██··
·██·
·▟█▙·
···█·`,
	{
		defaultKey: 'a',
		colors: `
a···
aa··
·aa·
·kak·
···k·`,
	},
);

// Active sweep (ADR 0018 §4): a fixed-length ordered arc the renderer samples by
// swingProgress — first frame at 0, last at 1. The blade rotates around the hand from
// high → level → low; the Greatsword's long active duration spreads these three
// frames over a slow, weighty chop.
const active0 = new Sprite(
	`
···█·
··██·
··█··
·▟█▙·
··█··`,
	{
		defaultKey: 'a',
		colors: `
···a·
··aa·
··a··
·kak·
··k··`,
	},
);

const active1 = new Sprite(
	`
·····
·····
··███
·▟███
··█··`,
	{
		defaultKey: 'a',
		colors: `
·····
·····
··aaa
·kaaa
··k··`,
	},
);

const active2 = new Sprite(
	`
·····
·····
·▟█▙·
··███
··█··`,
	{
		defaultKey: 'a',
		colors: `
·····
·····
·kak·
··aaa
··k··`,
	},
);

// Recovery: the blade hangs low and forward, the swing spent — slow to reset.
const recovery = new Sprite(
	`
·····
·····
·▟▙··
··██·
··█▙·`,
	{
		defaultKey: 'a',
		colors: `
·····
·····
·kk··
··aa·
··ka·`,
	},
);

export const greatsword: WeaponSprite = {
	frames: { idle, windup, active: [active0, active1, active2], recovery },
	// Hand at col 2, bottom row — identical across every frame so the blade pivots
	// around a fixed grip; aligned grip-to-grip with the body's grip cell.
	grip: { x: 2, y: 4 },
	// Cyan — the rarity-ready accent channel (today a hand-authored palette key) that
	// repaints the blade's `a` cells, distinct from the Sword's steel.
	accent: 'c',
};
