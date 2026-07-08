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
	// Held, not a tap: any raised Guard is a Block, a frontal brace (ADR 0017 §5).
	guard?: boolean;
	interact?: boolean;
	// A dedicated key, not a double-tap: starts an i-frame hop when the Avatar is free (ADR 0017 §5).
	dodge?: boolean;
	// 1-based slot of a Class Skill to activate this tick (absent == none).
	skill?: number;
}

export type EntityType = 'player' | 'chaser' | 'shooter' | 'brute';

// windup commits the attacker (no hitbox yet), active is the only window the hitbox is
// live, recovery leaves the attacker exposed (ADR 0017 §1).
export type AttackPhase = 'windup' | 'active' | 'recovery';

// `dodge` reuses the AttackPhase values for its active/recovery phases (ADR 0017 §5).
export type MoveId = 'idle' | 'basic' | 'dodge';

// Broadcast per entity so offense is visible to everyone (ADR 0017 §10), derived from
// the swing timer by `actionStateOf`. `phase`/`progress` are meaningless when `move` is
// idle — a guard is a stance riding `flags` over an idle action, not a move.
export interface ActionState {
	move: MoveId;
	phase: AttackPhase;
	progress: number; // 0..1 through the current phase
	flags: number; // reaction/defense bitfield (ACTION_FLAG.*)
	// Replicated in the action-state (not a fire-and-forget event) so an observer who
	// arrives mid-emote still sees the pose; `emoteT` drives the frame sweep (ADR 0020 §9).
	emote: string | null;
	emoteT: number;
}

// Small integer indices into fixed catalogs (cosmetics.ts). Purely decorative and
// client-rendered; the indices travel on the wire so every client renders an Avatar's
// look identically (#35, ADR 0003).
export interface Cosmetics {
	hue: number; // index into HUES
	hat: number; // index into HATS; 0 == bareheaded
	nameplate: number; // index into NAMEPLATE_COLORS
	form: number; // index into FORMS — the Avatar's body Pose set (ADR 0020); 0 == default humanoid
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
	// Seconds before a Monster may COMMIT its next telegraphed attack, so it paces its
	// attacks rather than acting every frame in range. Distinct from `attackT` (the swing
	// telegraph). Absent == 0 (ready). Server-internal (ADR 0017 §8/§9).
	attackCdT?: number;
	// Momentum body (ADR 0017): every entity integrates on one body, so Knockback reuses
	// the same gravity + drag + Terrain collision.
	mass?: number; // resistance to impulse displacement; absent == DEFAULT_MASS (1)
	// External-impulse horizontal velocity (cells/s), decayed by drag. Kept apart from
	// input-driven velocity, which is recomputed each tick and would otherwise erase a
	// shove. Vertical impulses just add into `vy`. Absent == 0.
	ivx?: number;
	// Accumulating pool regulating whether a hit Staggers: a hit that drives it to 0
	// BREAKS (refilling it) and Staggers. Absent == full. Server-tracked (ADR 0017 §3).
	poise?: number;
	// Per-archetype "how hard to stagger" lever — the Poise ceiling: a heavy brute carries
	// a larger pool. Absent == shared COMBAT.poise.max. Server-tracked (ADR 0017 §3).
	poiseMax?: number;
	// Seconds before Poise regen resumes, re-armed on every poise hit — so under a flurry
	// the pool only accumulates and breaks. Absent == 0 (regen active). Server-tracked (ADR 0017 §3).
	poiseT?: number;
	// Hitstun: seconds of remaining Stagger. While > 0 CONTROL is locked (no AI/input) but
	// the body still integrates Knockback + gravity, so a staggered entity flies. Absent
	// == 0 (ADR 0017 §2).
	stunT?: number;
	// Seconds remaining in an i-frame hop: the `active` window grants invulnerability, the
	// `recovery` tail is exposed and committed (no re-dodge). Absent == 0. Server-tracked
	// for the i-frame gate; the hop impulse lives on the client momentum body (ADR 0017 §5).
	dodgeT?: number;
	// The re-dodge lockout spam-gate: armed at dodge start, so it outlives `dodgeT` by the
	// `cooldown` tail. Absent == 0 (ready). Owner-local, never replicated (ADR 0017 §5).
	dodgeCdT?: number;
	// Seconds the Guard has been HELD this raise; any positive value is a raised Block.
	// Absent == 0. Server-tracked and owner-predicted; replicated to others via the
	// action-state `flags`, never as a raw number (ADR 0017 §5).
	guardT?: number;
	// Ids an in-flight basic swing has already hit, so a swing connects with each target
	// at most once. Cleared when a fresh swing starts. Server-internal (ADR 0017 §2).
	swingHits?: number[];
	// Skill cooldowns, keyed by skill id → seconds remaining. Avatar-only and owner-local;
	// never replicated. Absent == no skills on cooldown (ADR 0022).
	skillCooldowns?: Record<string, number>;
	spawnIndex?: number; // index into its Zone's spawns[], if Field-spawned
	contributors?: number[]; // Monster-only: session ids that have damaged it, for shared-kill rewards (#37)
	name?: string; // display handle for a Player Avatar's nameplate (absent for Monsters)
	cosmetics?: Cosmetics; // Avatar customization (#35); render-only, absent for Monsters
	// Equipped Weapon catalog index: replicated appearance plus the key to its stat block
	// (damage + weapon visual). Absent == the default Warrior sword. Monsters leave it
	// unset (ADR 0024).
	weapon?: number;
	bubble?: string; // latest Chat line shown as an over-head Speech bubble (#59); render-only
	// Active body emote id + seconds remaining. Authoritative state (rides the wire in the
	// action-state, not render-only metadata); cleared the instant the Avatar moves or
	// fights (ADR 0020 §9).
	emoteId?: string;
	emoteT?: number;
	// Replicated action-state for a co-present entity, so the renderer can draw its swing.
	// The local Avatar leaves this absent — its swing derives from predicted `attackT`.
	// Render-only (ADR 0017 §10).
	action?: ActionState;
}

// blood is the chip-hit kind; gore the entity-tinted death burst (#139); impact the
// heavy Poise-break burst that pairs with client hitstop + camera-kick (ADR 0017 §13d).
export type EffectKind = 'blood' | 'gore' | 'impact';

// An RGB colour tinting an Effect's particles; each channel is 0..255 (#139).
export interface Tint {
	r: number;
	g: number;
	b: number;
}

// A deterministic descriptor of what happened in combat; the client realizes it into a
// non-deterministic cloud of Particles (the shared layer owns the fact, the client the
// pixels). `dir` is the burst's horizontal bias — ±1 follow the blow, 0 is radial (ADR 0013).
export interface Effect {
	kind: EffectKind;
	x: number;
	y: number;
	intensity: number; // scales with damage dealt; the client maps it to a speck count
	dir: -1 | 0 | 1;
	// Optional RGB recolour: a death gore burst carries the dead entity's body colour.
	// Rides the wire (unlike `source`); absent for the fixed-palette `blood` kind (#139).
	tint?: Tint;
	// The session that caused this Effect, so the server can suppress sending it back to
	// its originator (which already predicted its own blood). Server-internal, never on
	// the wire (ADR 0013).
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

// A Strike only lands on OPPOSING-Faction victims, so the PvE invariant holds by
// construction: two Avatars share `players`, so no Avatar Strike selects an Avatar (ADR 0022).
export type Faction = 'players' | 'monsters';

// A projected attack handed to combat resolution: "this hitbox deals this damage/poise,
// facing →, for this Faction." A PROJECTION, never applied at the project site. The
// per-swing dedup ledger (`swingHits`) is NOT here — it is a multi-contact property of
// the source entity, kept as a keyed side-table at the resolution site (ADR 0022).
export interface Strike {
	attackerId: number;
	attackerKind: 'avatar' | 'monster' | 'projectile';
	hitbox: Box; // a swing's active box this tick (OR a projectile's body, later slices)
	damage: number;
	poiseDamage: number;
	facing: Facing;
	faction: Faction; // selects valid victims: opposing-Faction only
}

// A hit that travels, carrying the SAME hit-reaction payload a melee swing does, so a
// heavy shot can Stagger like a melee connect while a pebble only chips. Travels at a
// reactable speed (not hitscan). Always hostile — no player-owned shot (ADR 0017 §8).
export interface Projectile {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number; // remaining lifetime, seconds
	damage: number;
	// Hit-reaction payload mirroring a Weapon's stat block. Absent on a decoded legacy
	// shot defaults to the SHOOTER pebble values (ADR 0017 §8).
	poiseDamage: number;
	knockback: number;
	knockbackUp: number;
}

export interface Npc extends Box {
	id: number;
	kind: 'vendor' | 'signpost';
	name: string;
	// Signpost nudge lines shown when a Player reads it. Absent for a vendor, whose
	// interaction is the shop.
	lines?: string[];
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

// A killed Monster's rolled Item resting at the kill site, COLLECTED ON TOUCH when its
// owner walks over it. Instanced loot, so a Drop is PRIVATE: only `owner` sees or picks
// it up, and `snapshotFor` streams a recipient only its own Drops (#238, ADR 0024 §2).
export interface Drop extends Box {
	id: number;
	owner: number;
	item: Item;
	ttl: number; // seconds it rests before fading
}

// Runtime state is split along the authority boundary: the shared World in world.ts,
// the per-client Player in player.ts (ADR 0001).
