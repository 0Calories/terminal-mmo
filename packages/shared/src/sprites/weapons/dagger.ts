import { Sprite } from '../sprite';
import type { WeaponSprite } from '../weapon-sprite';

// The Dagger's appearance (ADR 0018, #184). A short, light blade that reads SMALL at
// rest — a stubby point over the hand, far shorter than the Sword or Greatsword.
// Authored right-facing; the renderer mirrors the art (and the grip column) when the
// Avatar faces left.
//
// Every frame is a fixed 4×3 canvas anchoring the GRIP (the hand) at the same cell
// (col 1, row 2), so the blade pivots around a fixed hand — a single grip serves every
// frame. `·` (SENTINEL) marks a transparent padding cell so leading/trailing rows
// survive trimming and the grip row stays aligned frame to frame.
//
// The same fixed-length active sweep as every weapon: the Dagger's SHORT phase
// DURATIONS (its stat block) make this identical-length sweep flick by fast and light,
// where the Greatsword's plays slow — heft is duration-driven, not frame-count-driven.
//
// Blade cells carry the dynamic ACCENT key (`a`, ADR 0018 §6) so the whole blade, its
// blade-edge arc and its Trail read in the weapon's one accent colour (green here) and
// re-tint with rarity later; the guard keeps its authored key. Distinct from the
// Sword's steel and the Greatsword's cyan.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.

// Rest: a short point upright in the hand.
const idle = new Sprite(
	`
·▲··
·█··
·▆··`,
	{
		defaultKey: 'a',
		colors: `
·a··
·a··
·k··`,
	},
);

// Wind-up: the point flicked back, cocked for a quick jab.
const windup = new Sprite(
	`
▲···
·█··
·▆··`,
	{
		defaultKey: 'a',
		colors: `
a···
·a··
·k··`,
	},
);

// Active sweep (ADR 0018 §4): a fixed-length ordered arc sampled by swingProgress —
// first frame at 0, last at 1. The point flicks from high through a forward poke to
// low; the Dagger's short active duration whips these three frames by in a blink.
const active0 = new Sprite(
	`
·▲··
·█··
·▆··`,
	{
		defaultKey: 'a',
		colors: `
·a··
·a··
·k··`,
	},
);

const active1 = new Sprite(
	`
····
·▆█▸
·▘··`,
	{
		defaultKey: 'a',
		colors: `
····
·kaa
·k··`,
	},
);

const active2 = new Sprite(
	`
····
·▆··
·█▸·`,
	{
		defaultKey: 'a',
		colors: `
····
·k··
·aa·`,
	},
);

// Recovery: the point dropped low after the jab, quick to reset.
const recovery = new Sprite(
	`
····
·▆··
·▙··`,
	{
		defaultKey: 'a',
		colors: `
····
·k··
·a··`,
	},
);

export const dagger: WeaponSprite = {
	frames: { idle, windup, active: [active0, active1, active2], recovery },
	// Hand at col 1, bottom row — identical across every frame so the blade pivots
	// around a fixed grip; aligned grip-to-grip with the body's grip cell.
	grip: { x: 1, y: 2 },
	// Green — the rarity-ready accent channel (today a hand-authored palette key) that
	// repaints the blade's `a` cells, distinct from the Sword's steel and Greatsword's cyan.
	accent: 'g',
};
