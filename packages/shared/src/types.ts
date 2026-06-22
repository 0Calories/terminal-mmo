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
	bubble?: string; // latest Chat line shown as an over-head Speech bubble (#59); render-only
	emote?: string; // active emote id shown over the head (#38); render-only
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
