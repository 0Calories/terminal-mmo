// Core data shapes for the simulation. Domain meanings live in /CONTEXT.md.

export type Facing = 1 | -1;

/** Solid geometry of a Zone. Avatars collide with this and nothing else. */
export interface Terrain {
	w: number;
	h: number;
	cells: Uint8Array; // 1 = solid, 0 = empty; row-major (y * w + x)
}

/** Movement intent for one entity for one tick. */
export interface Control {
	moveX: -1 | 0 | 1;
	jump: boolean;
}

/** A Player's intent for one tick (movement + attack + interact). */
export interface Input extends Control {
	attack: boolean;
	// the umbrella "engage" intent: enter Portals, talk to NPCs, pick up Items,
	// use objects — whatever the Avatar is standing on or next to.
	interact?: boolean;
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
	hurtT: number; // remaining invulnerability (seconds)
	attackT: number; // remaining attack cooldown (seconds)
	spawnIndex?: number; // index into its Zone's spawns[], if Field-spawned
}

/** A fixed point in a Field where a Monster spawns and respawns (CONTEXT: Field
 * — Monsters spawn at fixed points and respawn on a timer, story 20). */
export interface SpawnPoint {
	type: EntityType;
	x: number;
	y: number;
}

/** A Monster death awaiting respawn: a fresh Monster appears at spawns[spawnIndex]
 * once `remaining` (seconds, counted down by dt) reaches zero. */
export interface PendingRespawn {
	spawnIndex: number;
	remaining: number;
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A travelling damage source fired by a ranged Monster (CONTEXT: Combat —
 * ranged is precise directional projectiles). Small, straight-line, transient:
 * it despawns on Terrain, on Avatar overlap, or when its lifetime runs out. */
export interface Projectile {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number; // remaining lifetime (seconds)
	damage: number;
	ownerId: number; // the Monster that fired it
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Slot = 'weapon' | 'armor' | 'accessory';

export interface ItemAffix {
	stat: string;
	value: number;
}

/** Item = base type + rarity tier + randomized affixes (CONTEXT: Item). */
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

// The runtime state is split across two modules along the authority boundary
// (ADR 0001): the shared World of Zones lives in world.ts; the client Player's
// own state lives in player.ts; sim.ts bundles them as GameState.
