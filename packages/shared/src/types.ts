export type Facing = 1 | -1;

export interface Terrain {
	w: number;
	h: number;
	cells: Uint8Array; // 1 = solid, 0 = empty; row-major (y * w + x)
}

export interface Control {
	moveX: -1 | 0 | 1;
	jump: boolean;
}

export interface Input extends Control {
	attack: boolean;
	interact?: boolean;
	// 1-based slot of a Class Skill to activate this tick (absent == none).
	skill?: number;
}

export type EntityType = 'player' | 'chaser' | 'shooter';

// One Avatar's cosmetic choices (#35, ADR 0003): a body hue, one cosmetic hat
// (separate from gear), and a nameplate colour, each a small integer index into a
// fixed, reviewed catalog (see cosmetics.ts). Purely decorative and client-rendered
// like the Sprite; the indices travel on the wire so every client renders every
// Avatar's look identically.
export interface Cosmetics {
	hue: number; // index into HUES
	hat: number; // index into HATS; 0 == bareheaded
	nameplate: number; // index into NAMEPLATE_COLORS
}

export interface Entity {
	id: number;
	type: EntityType;
	x: number;
	y: number;
	vx: number;
	vy: number;
	speed: number;
	facing: Facing;
	onGround: boolean;
	hp: number;
	maxHp: number;
	hurtT: number; // remaining invulnerability, seconds
	attackT: number; // remaining attack cooldown, seconds
	spawnIndex?: number; // index into its Zone's spawns[], if Field-spawned
	contributors?: number[]; // Monster-only: session ids that have damaged it, for shared-kill rewards (#37)
	name?: string; // display handle for a Player Avatar's nameplate (absent for Monsters)
	cosmetics?: Cosmetics; // Avatar customization (#35); render-only, absent for Monsters
	bubble?: string; // latest Chat line shown as an over-head Speech bubble (#59); render-only
	emote?: string; // active emote id shown over the head (#38); render-only
}

// The semantic game event a burst represents. `blood` is the MVP kind; future
// kinds (dust, sparkle, spark, smoke) are added here as the system grows.
export type EffectKind = 'blood';

// A small, authoritative, deterministic descriptor of *what happened* in combat,
// produced in the shared Zone tick the instant damage resolves (ADR 0013). The
// client realizes it into a non-deterministic cloud of Particles; the shared
// layer owns the fact, the client owns the pixels. `dir` is the horizontal bias
// of the burst — -1 / 1 follow the blow, 0 is a radial burst (used by deaths).
export interface Effect {
	kind: EffectKind;
	x: number;
	y: number;
	intensity: number; // scales with damage dealt; the client maps it to a speck count
	dir: -1 | 0 | 1;
}

export interface SpawnPoint {
	type: EntityType;
	x: number;
	y: number;
}

export interface PendingRespawn {
	spawnIndex: number;
	remaining: number; // seconds, counted down by dt
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Projectile {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number; // remaining lifetime, seconds
	damage: number;
	ownerId: number;
}

export interface Npc extends Box {
	id: number;
	kind: 'vendor';
	name: string;
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Slot = 'weapon' | 'armor' | 'accessory';

export interface ItemAffix {
	stat: string;
	value: number;
}

export interface Item {
	id: number;
	base: string;
	slot: Slot;
	rarity: Rarity;
	affixes: ItemAffix[];
}

export interface PlayerProgress {
	level: number;
	xp: number;
	gold: number;
}

// Runtime state is split along the authority boundary (ADR 0001): the shared
// World lives in world.ts, the per-client Player in player.ts.
