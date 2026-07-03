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
	// Raise the Guard this tick (ADR 0017 §5): held, not a tap. Any raised Guard is a
	// Block, a frontal brace chipping HP + draining Poise (Parry removed, ADR 0024).
	guard?: boolean;
	interact?: boolean;
	// Dodge intent (ADR 0017 §5): a dedicated key, not a double-tap. When the Avatar
	// is free it starts an i-frame hop in the held (or facing) direction.
	dodge?: boolean;
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
// swing; `dodge` = the i-frame hop (ADR 0017 §5), whose `active`/`recovery` phases
// reuse the AttackPhase values. Skills and Monster moves join this set as later
// combat slices land.
export type MoveId = 'idle' | 'basic' | 'dodge';

// A compact, authoritative description of what an entity is *doing* this tick,
// broadcast for every entity in the snapshot so offense is visible to everyone
// (ADR 0017 §10) — this replaces the old client-local swing telegraph. Derived
// from the entity's swing timer by `actionStateOf`, never hand-authored. `phase` +
// `progress` drive the client's per-phase sprite pose and the slash-arc (live only
// while `active`); `flags` is a bitfield surfacing reaction/defense state — the
// `staggered`, `guarding`, and `dodging` bits (ACTION_FLAG.*) are set here so a
// co-present Player's Stagger and Guard stance are visible to everyone (ADR 0017
// §5/§10); an airborne bit is reserved for later. `phase`/`progress` are meaningless
// when `move` is idle — a guard is a stance, not a move, riding `flags` over an idle action.
export interface ActionState {
	move: MoveId;
	phase: AttackPhase;
	progress: number; // 0..1 through the current phase
	flags: number; // reaction/defense bitfield (ACTION_FLAG.*)
	// The active body emote (ADR 0020 §9): the emote id its body is posing, or null when
	// none, plus the seconds remaining on its lifetime. Replicated in the action-state
	// (not a fire-and-forget event) so an observer who arrives mid-emote still sees the
	// pose; the owner predicts its own. `emoteT` drives the pose's frame sweep.
	emote: string | null;
	emoteT: number;
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
	// Ranged-poker fire cadence (ADR 0017 §8): seconds remaining before a shooter may
	// COMMIT its next telegraphed shot, set on firing and counted down each tick so the
	// poker paces its shots rather than auto-firing. Distinct from `attackT` (the swing
	// telegraph itself). Absent == 0 (ready). Server-internal; never on the wire.
	fireCdT?: number;
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
	// Dodge (ADR 0017 §5): seconds remaining in an i-frame hop (active + recovery),
	// counting down to 0 (ready). The `active` window grants invulnerability; the
	// `recovery` tail leaves the Avatar exposed and committed (no re-dodge). Derived
	// into the action-state for replication, exactly like `attackT` drives the swing.
	// Absent == 0 (not dodging). Server-tracked for the i-frame gate; the hop impulse
	// itself lives on the client-authoritative momentum body (ADR 0001).
	dodgeT?: number;
	// Dodge cooldown (ADR 0017 §5): seconds remaining in the post-recovery lockout
	// before a fresh hop can START. Set to the full lockout (active + recovery +
	// cooldown) at dodge start and counted down each tick, so it outlives `dodgeT` by
	// the `cooldown` tail — the spam-gate. Absent == 0 (ready). Owner-local: gates the
	// owning Avatar's `canStartDodge` on client + server alike; never replicated (no
	// other client renders it), so it stays OFF the wire.
	dodgeCdT?: number;
	// Guard (ADR 0017 §5): seconds the Guard has been HELD this raise, counting up
	// while the guard intent is held and reset to 0 on release / swing / Stagger. Any
	// positive value is a raised Block (a frontal brace chipping HP + draining Poise);
	// the held duration itself no longer gates behaviour. Absent == 0 (not guarding).
	// Server-tracked AND predicted by the owner; replicated to others through the
	// action-state `flags`, never as a raw number.
	guardT?: number;
	// Ids an in-flight basic swing has already hit (ADR 0017 §2): a swing connects
	// with a given target at most once, the rate-limiter that replaced the removed
	// automatic post-hit i-frames. Cleared when a fresh swing starts; a NEW swing (or
	// another attacker) can still hit a target that is mid-Stagger. Server-internal.
	swingHits?: number[];
	// Skill cooldowns, keyed by skill id → seconds remaining (ADR 0022 slice 2): the
	// settled home for the per-Avatar skill timers that slice 1 round-tripped through
	// `stepAvatarCombat`'s return. Storing them on the Entity lets the shared fold stay
	// pure and collapse its return to `{ avatar, strikes }` — the cooldowns ride the
	// folded avatar instead. Avatar-only; never replicated (skill cooldowns are owner-
	// local — `ServerAvatar.skillCooldowns` points at this same object server-side, the
	// client reads it off its predicted avatar). Absent == no skills on cooldown.
	skillCooldowns?: Record<string, number>;
	spawnIndex?: number; // index into its Zone's spawns[], if Field-spawned
	contributors?: number[]; // Monster-only: session ids that have damaged it, for shared-kill rewards (#37)
	name?: string; // display handle for a Player Avatar's nameplate (absent for Monsters)
	cosmetics?: Cosmetics; // Avatar customization (#35); render-only, absent for Monsters
	// Equipped Weapon catalog index: part of an Avatar's replicated appearance, and
	// the key to its stat block — the swing's damage plus the composited weapon visual
	// (sprite + accent, ADR 0024; every weapon shares the one moveset). Absent == the
	// default Warrior sword (DEFAULT_WEAPON), so an unarmed entity plays exactly as
	// before. Monsters leave it unset (their offense rework is a later slice).
	weapon?: number;
	bubble?: string; // latest Chat line shown as an over-head Speech bubble (#59); render-only
	// Active body emote (ADR 0020 §9): the emote id the Avatar's body is posing and the
	// seconds remaining on its `oneshot` lifetime. Authoritative entity state — the server
	// owns it, the owning client predicts it, and it rides the wire inside the action-state
	// (not as render-only metadata). Absent == no active emote. Set on the `/em` trigger,
	// counted down each tick, and cleared the instant the Avatar moves or fights (§6).
	emoteId?: string;
	emoteT?: number;
	// Replicated action-state for a co-present entity (ADR 0017 §10): set by the
	// client when rebuilding an Entity from a snapshot so the renderer can draw its
	// swing (pose + slash-arc). The local Avatar leaves this absent — its swing is
	// derived from the predicted `attackT` instead. Render-only.
	action?: ActionState;
}

// The semantic game event a burst represents. `blood` is the chip-hit MVP kind;
// `gore` is the meatier, entity-tinted death burst (#139); `impact` is the heavy
// Poise-break burst (ADR 0017 §13d) — bigger and sharper than a chip, the visual
// twin of the Stagger that pairs with client hitstop + camera-kick. Future
// kinds (guard-break, launch) are added here as the system grows.
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

// The allegiance key a Strike resolves against (ADR 0022): a Strike only lands on
// OPPOSING-Faction victims. So the PvE invariant holds BY CONSTRUCTION rather than by
// scattered checks — two Avatars share `players`, so no Avatar Strike selects an
// Avatar. Every Strike carries one; the resolution rule reads it, never re-derives it.
export type Faction = 'players' | 'monsters';

// The projected-attack value a project pass hands to combat resolution (ADR 0022):
// "this hitbox deals this damage/poise, facing →, on behalf of this Faction." It is a
// PROJECTION, never applied at the project site — the uniform resolution rule lands
// every Strike against overlapping, hittable, opposing-Faction, not-already-hit
// victims. It replaces slice 1's positional `hitboxes[]` / `damages[]` parallel
// arrays, carrying attacker identity + facing + poise + faction so resolution
// re-derives none of them. The per-swing dedup ledger (`swingHits`) is NOT a field
// here — it is a multi-contact property of the source entity, read/written as a keyed
// side-table at the resolution site.
export interface Strike {
	attackerId: number;
	attackerKind: 'avatar' | 'monster' | 'projectile';
	hitbox: Box; // a swing's active box this tick (OR a projectile's body, later slices)
	damage: number;
	poiseDamage: number;
	facing: Facing;
	faction: Faction; // selects valid victims: opposing-Faction only
}

// A first-class hit that travels (ADR 0017 §8): a Projectile carries the SAME
// hit-reaction payload a melee swing does — HP `damage`, `poiseDamage` toward a
// Poise break, and the `knockback` (+ `knockbackUp` pop) thrown on that break — so a
// heavy shot can Stagger exactly like a melee connect (scaled by Mass), while a
// pebble only chips. It travels at a reactable speed (not hitscan) and is a hostile
// shot countered by Dodge, Block, or a melee swat. Every Projectile threatens
// Avatars — with Reflect removed (ADR 0024) there is no player-owned shot.
export interface Projectile {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number; // remaining lifetime, seconds
	damage: number;
	// The full hit-reaction payload (ADR 0017 §8), mirroring a Weapon's stat block:
	// Poise damage toward a break, and the Knockback impulse (+ upward pop) thrown on
	// one. Absent on a decoded legacy shot defaults to the SHOOTER pebble values.
	poiseDamage: number;
	knockback: number;
	knockbackUp: number;
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
