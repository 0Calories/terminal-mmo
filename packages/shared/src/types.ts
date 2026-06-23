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

// The three phases every attack runs through (ADR 0017 §1): `windup` commits the
// attacker (telegraphed, no hitbox yet), `active` is the only window the hitbox is
// live, `recovery` leaves the attacker exposed. In this foundational slice only the
// Player's basic swing is phased; Monsters stay on their MVP behavior and replicate
// an idle action-state.
export type AttackPhase = 'windup' | 'active' | 'recovery';

// The move an entity is performing. `idle` = nothing; `basic` = the basic melee
// swing. Skills and Monster moves join this set as later combat slices land.
export type MoveId = 'idle' | 'basic';

// A compact, authoritative description of what an entity is *doing* this tick,
// broadcast for every entity in the snapshot so offense is visible to everyone
// (ADR 0017 §10) — this replaces the old client-local swing telegraph. Derived
// from the entity's swing timer by `actionStateOf`, never hand-authored. `phase` +
// `progress` drive the client's per-phase sprite pose and the slash-arc (live only
// while `active`); `flags` is a bitfield surfacing reaction/defense state — the
// `staggered` bit (ACTION_FLAG.staggered) is set here, with guarding / airborne bits
// reserved for later slices. `phase`/`progress` are meaningless when `move` is idle.
export interface ActionState {
	move: MoveId;
	phase: AttackPhase;
	progress: number; // 0..1 through the current phase
	flags: number; // reaction/defense bitfield (ACTION_FLAG.*)
}

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
	// Momentum body (ADR 0017). Every entity — Avatar or Monster — integrates on
	// one body so a later slice can throw it with a Knockback impulse and reuse the
	// same gravity + drag + Terrain collision.
	mass?: number; // resistance to impulse displacement; absent == DEFAULT_MASS (1)
	// External-impulse horizontal velocity (cells/s): the part of horizontal motion
	// that survives between ticks (a Knockback shove), decayed by drag. Kept apart
	// from input-driven velocity, which is recomputed fresh each tick and would
	// otherwise erase a shove. Vertical impulses need no channel — they add straight
	// into `vy`, which already carries momentum under gravity. Absent == 0.
	ivx?: number;
	// Poise (ADR 0017 §3): the accumulating pool that regulates whether a hit
	// Staggers. Depletes by an attack's poise damage, regenerates under no pressure,
	// and a hit that drives it to 0 BREAKS (refilling it) and triggers Stagger. Absent
	// == full (DEFAULT poise.max). Server-tracked; never on the wire.
	poise?: number;
	// Seconds remaining before Poise regen resumes (ADR 0017 §3): set to
	// COMBAT.poise.regenDelay on every poise hit and counted down each tick, so the
	// pool only regenerates "under no pressure" — under a flurry it purely accumulates
	// and breaks. Absent == 0 (regen active). Server-tracked; never on the wire.
	poiseT?: number;
	// Hitstun (ADR 0017 §2): seconds of remaining Stagger. While > 0 the victim's
	// CONTROL is locked (no AI / input drive) but its body still integrates Knockback
	// + gravity, so a staggered entity flies. Absent == 0 (acting normally). The
	// staggered state is surfaced to clients through the action-state `flags` bit.
	stunT?: number;
	// Ids an in-flight basic swing has already hit (ADR 0017 §2): a swing connects
	// with a given target at most once, the rate-limiter that replaced the removed
	// automatic post-hit i-frames. Cleared when a fresh swing starts; a NEW swing (or
	// another attacker) can still hit a target that is mid-Stagger. Server-internal.
	swingHits?: number[];
	spawnIndex?: number; // index into its Zone's spawns[], if Field-spawned
	contributors?: number[]; // Monster-only: session ids that have damaged it, for shared-kill rewards (#37)
	name?: string; // display handle for a Player Avatar's nameplate (absent for Monsters)
	cosmetics?: Cosmetics; // Avatar customization (#35); render-only, absent for Monsters
	bubble?: string; // latest Chat line shown as an over-head Speech bubble (#59); render-only
	emote?: string; // active emote id shown over the head (#38); render-only
	// Replicated action-state for a co-present entity (ADR 0017 §10): set by the
	// client when rebuilding an Entity from a snapshot so the renderer can draw its
	// swing (pose + slash-arc). The local Avatar leaves this absent — its swing is
	// derived from the predicted `attackT` instead. Render-only.
	action?: ActionState;
}

// The semantic game event a burst represents. `blood` is the chip-hit MVP kind;
// `gore` is the meatier, entity-tinted death burst (#139); `impact` is the heavy
// Poise-break burst (ADR 0017 §13d) — bigger and sharper than a chip, the visual
// twin of the Stagger that pairs with client hitstop + camera-kick. Future kinds
// (parry clash, guard-break, launch) are added here as the system grows.
export type EffectKind = 'blood' | 'gore' | 'impact';

// An RGB colour carried on an Effect to tint its particles (#139), e.g. a death
// burst recoloured to the dead entity's body. Each channel is 0..255.
export interface Tint {
	r: number;
	g: number;
	b: number;
}

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
	// Optional RGB recolour for this burst's particles (#139): a death gore burst
	// carries the dead entity's body colour so the splatter matches what died. Rides
	// the wire (unlike `source`); absent for the fixed-palette `blood` kind.
	tint?: Tint;
	// The session that caused this Effect, set at the emission site so the server
	// can suppress sending it back to its originator (the acting client already
	// predicted its own blood, ADR 0013). Server-internal attribution only: it is
	// never serialized onto the wire and is absent on a decoded Effect.
	source?: number;
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
