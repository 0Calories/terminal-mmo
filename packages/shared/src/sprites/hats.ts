import { Sprite } from './sprite';

// The cosmetic hat catalog (#35, ADR 0003). A hat is a small, decorative Sprite
// overlaid on top of the Avatar's head — cosmetic only, entirely separate from
// gear. Index 0 is the bareheaded default (`sprite: null`); the rest are a small,
// fixed, hand-authored set. Colours reference the shared SCENE_PALETTE keys so a
// hat tints through the same path as every other Sprite. Anchored above the head
// by the renderer (drawEntitySprite), so a hat never occludes the face.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
export interface HatDef {
	// Display label for the (later) picker and for catalog review.
	name: string;
	// The overlay art, or null for the bareheaded default.
	sprite: Sprite | null;
}

// A simple visor/cap brim.
const cap = new Sprite(`▄█████▄`, { defaultKey: 'o' });

// A regal crown.
const crown = new Sprite(`█▄█▄█`, { defaultKey: 'y' });

// A pointed wizard's hat.
const wizard = new Sprite(
	`
··▟█▙··
·▟███▙·
███████`,
	{
		defaultKey: 'c',
		colors: `
··ccc··
·ccccc·
·ooooo·`,
	},
);

// A top hat with a coloured band.
const topHat = new Sprite(
	`
·█████·
·█████·
▄█████▄`,
	{
		defaultKey: 'k',
		colors: `
·kkkkk·
·mmmmm·
kkkkkk`,
	},
);

// A festive cone party hat with a coloured band — the demo's one added hat, landing the
// catalog at ADR 0024 §8's 4–5 hats cap (the four originals + this one).
const partyHat = new Sprite(
	`
··▲··
·▟█▙·
▄███▄`,
	{
		defaultKey: 'c',
		colors: `
··y··
·ccc·
·mmm·`,
	},
);

// Index is the on-the-wire cosmetic hat id; order is stable (append only).
export const HATS: readonly HatDef[] = [
	{ name: 'None', sprite: null },
	{ name: 'Cap', sprite: cap },
	{ name: 'Crown', sprite: crown },
	{ name: 'Wizard', sprite: wizard },
	{ name: 'Top Hat', sprite: topHat },
	{ name: 'Party Hat', sprite: partyHat },
];
