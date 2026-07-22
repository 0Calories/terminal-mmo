export type Facing = 1 | -1;

export interface Terrain {
	w: number;
	h: number;
	cells: Uint8Array;
}

export interface Control {
	moveX: -1 | 0 | 1;
	jump: boolean;
}

export interface Input extends Control {
	attack: boolean;
	guard?: boolean;
	interact?: boolean;
	dodge?: boolean;
	skill?: number;
}

export type EntityType = 'player' | 'chaser' | 'shooter' | 'brute';

export type MonsterType = Exclude<EntityType, 'player'>;

export type AttackPhase = 'windup' | 'active' | 'recovery';

export type MoveId = 'idle' | 'basic' | 'dodge';

export interface ActionState {
	move: MoveId;
	phase: AttackPhase;
	progress: number;
	flags: number;
	emote: string | null;
	emoteT: number;
}

export interface Cosmetics {
	hue: number;

	hat: string;
	nameplate: number;

	form: string;
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
	hurtT: number;
	attackT: number;
	attackCdT?: number;
	mass?: number;
	// Impulse velocity kept apart from input velocity (recomputed each tick), else a shove is erased.
	ivx?: number;
	poise?: number;
	poiseMax?: number;
	poiseT?: number;
	stunT?: number;
	dodgeT?: number;
	dodgeCdT?: number;
	guardT?: number;
	swingHits?: number[];

	ai?: unknown;
	skillCooldowns?: Record<string, number>;
	spawnIndex?: number;
	contributors?: number[];
	name?: string;
	cosmetics?: Cosmetics;
	weapon?: number;
	bubble?: string;
	emoteId?: string;
	emoteT?: number;
	action?: ActionState;
}

export interface Tint {
	r: number;
	g: number;
	b: number;
}

export interface SpawnPoint {
	type: MonsterType;
	x: number;
	y: number;
}

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

export type Faction = 'players' | 'monsters';

export interface Strike {
	attackerId: number;
	attackerKind: 'avatar' | 'monster' | 'projectile';
	hitbox: Box;
	damage: number;
	poiseDamage: number;
	facing: Facing;
	faction: Faction;

	attackerX?: number;

	knockback: number;
	knockbackUp: number;
}

export interface Projectile {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	damage: number;
	poiseDamage: number;
	knockback: number;
	knockbackUp: number;
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

export interface Drop extends Box {
	id: number;
	owner: number;
	item: Item;
	ttl: number;
}
