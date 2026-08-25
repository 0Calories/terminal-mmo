# Terminal Side-Scroller MMO

A persistent **PvE side-scrolling MMORPG** played entirely inside a terminal
(TUI). One shared, persistent World whose social hubs (**Towns**) and ambient
combat zones (**Fields**) are common to all Players; progression happens in
**instanced Dungeons**. Players control customizable avatars, fight Monsters
for XP / levels / loot, and gather in Towns. Real-time combat is a first-class
pillar. PvP and faction-war are parked. The audience is developers and
CLI-native users. Mental-model: "MapleStory in a terminal." A pet project —
the guiding value is coolness-per-unit-effort, not feature completeness.

## Language

**Player**:
A human participant / account. The person at the keyboard.
_Avoid_: User, gamer

**Avatar**:
The in-world character a Player controls and customizes; one per Player.
Rendered as an expressive multi-row ASCII-art figure. Customizable via a
**Form**, a hue, a cosmetic hat, and the **Nameplate** colour.
_Avoid_: Character, hero

**Form**:
The cosmetic appearance identity a Player picks for their Avatar — a variation
within the shared humanoid body plan. Purely visual: a Form changes only the
**Body sprite**, never the collision box, stats, or combat numbers.
_Avoid_: Race, species, class, skin

**Sprite**:
The visual ASCII-art representation of an entity. Presentation is decorative
and client-side — the simulation sees only position + box — but a Monster's
(and NPC's) logical box is *derived from* the visible pixel bounds of its
sprite's **Default frame** at asset load. An Avatar's box stays the canonical
uniform one whatever its Form; attack hitboxes stay authored, never derived.
_Avoid_: Art, model, skin

**Body sprite**:
The animated ASCII-art of an entity's body — a named set of whole-frame
**Animation**s. Each Form is one Body sprite. A frame is a *whole grid*, not a
composited skeleton — at terminal fidelity a limb is a cell or two. Must author
`idle` and `walk`; anything missing falls back to `idle`.
_Avoid_: Body model, rig, skeleton

**Animation**:
A named, ordered run of **Frame**s in a sprite, selected each render by a pure
shared function of replicated state so owner and observers agree. Body priority
is a fixed ladder — `hurt/stagger > combat > airborne > walk > emote > idle`
(walking cancels an **Emote**). Phase-bound animations (a weapon's `swing`, a
Monster's `windup`/`attack`/`recovery`) are indexed by the replicated **Attack
phase** and its progress, never by fps — more frames smooth a telegraph but
can never change its duration.
_Avoid_: Pose (retired), stance, animation state

**Walk cycle**:
The `walk` Animation advanced by accumulated horizontal distance travelled
(`stride % frameCount`), not a clock — free on the wire, identical for owner
and observers, quickens with speed. Freezes when idle or airborne.
_Avoid_: gait timer

**World**:
The single, persistent, shared space all Players inhabit — **funnelled, not
channelled**: each Zone runs exactly one shared instance, so whoever is online
shares one set of Towns/Fields. The only instancing is the Dungeon.
_Avoid_: Server, realm, map, Channel (removed parallel-instance split)

**Zone**:
A discrete, bounded side-scrolling locale that may span several screens. The
unit of place, of server simulation (each Zone ticks independently), and of
interest (a Player only receives updates about their own Zone). Kinds: **Town**
and **Field** run one shared simulation; a **Dungeon** spins up a private
**Instance** per entry.
_Avoid_: Map, level, room, screen

**Zone id**:
A Zone's stable identity — derived from its filename (`zones/<id>.zone`),
never a header field. What every Portal `target` references.
_Avoid_: Name, slug

**Zone name**:
A Zone's human-facing display label — optional, decorative, never used to
address a Zone.
_Avoid_: Title, id

**Town**:
A safe social Zone with no monsters — the hub.
_Avoid_: City, hub, lobby

**Field**:
A shared, persistent combat Zone populated by Monsters — the exploration
spine, difficulty gated by distance from Town. Where a Player *spends* power;
the **Dungeon** is where they *gain* it.
_Avoid_: Hunting map, dungeon, level

**Dungeon**:
An instanced, repeatable, fixed-difficulty combat Zone entered from Town, run
solo or with a friend — the reliable XP/loot faucet. Deliberately plain: no
tiers, no procgen, no matchmaking, no Boss inside. A Zone kind (authored
once); each entry spins up its own **Instance**.
_Avoid_: Instance (the runtime simulation, not the place), raid, stage

**Instance**:
The private, live ZoneState spun up when a Player (or **Party**) enters the
Dungeon. Keyed by the entering Party (`<zoneId>#<leader>`); torn down the
moment its last occupant leaves, so a re-entry is always a fresh run.
_Avoid_: Channel, session, shard

**Party**:
A small group who run a Dungeon together — a session's leader key routes co-op
entry into one shared Instance. Deliberately thin: not a social system.
_Avoid_: Group, raid, guild, Faction (that's the PvE damage filter)

**Boss**:
The single authored, telegraphing Monster gating the deepest Field — the
combat showcase's payoff and the demo's terminal state.
_Avoid_: Raid boss, elite, dungeon boss

**Identity Key**:
The ed25519 public key that identifies an account — the Player's own SSH key,
or a game-generated fallback minted on first keyless launch. A per-machine
**anchor** records which key won last; an unreachable external key is refused
with guidance, never silently replaced (that would orphan the Save).
_Avoid_: SSH key (it may be generated), guest key

**Handle**:
The durable, unique username a Player types and claims at Avatar creation,
bound to their Identity Key. It is the Nameplate text and Chat attribution.
Unique case-insensitively (2–16 of `[A-Za-z0-9_-]`); entities are still
*addressed* by session id at runtime — the Handle names the account.
_Avoid_: Username, nick, name, label

**Nameplate**:
The floating label showing an Avatar's Handle, tinted by a chosen palette
colour, rendered *below* the feet (headroom stays clear for the **Speech
bubble**). Only the colour is customizable.
_Avoid_: Name tag, label, title

**Save**:
The durable per-account snapshot (bun:sqlite), keyed by Identity Key. Holds
progression and identity only: level/XP/**Gold**, inventory + equipment,
Cosmetics, last safe Town, boss-defeated flag. Never Monsters, transient Zone
state, or exact position — login returns you to your last Town. Written on
significant events + periodic flush behind a pure store seam.
_Avoid_: Snapshot (the per-tick wire frame), checkpoint, profile

**Chat**:
Real-time text between Players. Zone chat relays to every session in the
sender's Zone; **Whisper** is its private form.
_Avoid_: Say, talk, message

**Whisper**:
Private Chat addressed by the recipient's Handle; never produces a Speech
bubble.
_Avoid_: DM, tell, private message

**Speech bubble**:
The ephemeral bordered text floating above a chatting Avatar's head — a purely
client-side rendering of Zone chat, attached by session id, expiring on a
timer. Wraps by terminal display columns, not string length.
_Avoid_: Chat bubble, balloon, tooltip

**Emote**:
A motion the Avatar's own body performs (`/wave`, `/dance`, `/sit`) — an
Animation on the Body sprite with a lifetime mode (`oneshot` / `loop` /
`hold`). Replicated in action-state so a late arrival still sees a held emote;
movement or combat clears it.
_Avoid_: Emoji, reaction, gesture

**CombatEvent**:
The resolved, semantic fact of a combat interaction — "target T was **hit** /
**broke** (poise) / **died** / was **swatted**, at (x,y), facing →, intensity
N". It **is** the wire payload: the server broadcasts CombatEvents and each
client projects them to presentation locally; the server holds no presentation
knowledge. The local Player predicts only its own optimistic `hit` (and is
suppressed from the broadcast); `break`/`death`/`swat` and incoming hurt are
authority-only. A discriminated union on `kind` — `source` rides a predicted
`hit` (and a `break`, solely so the attacker converts its predicted **Damage
number** instead of doubling it); `tint` rides a `death`.
_Avoid_: Effect (retired), HitEvent, Outcome

**VisualEffect**:
The client-side visual realization of a CombatEvent, produced by the `present`
routing layer — the one stateless place that knows a `break` means impact +
**Camera-kick** + **Hitstop** together. Never authoritative, never on the
wire.
_Avoid_: Effect (retired), FX, particle (that's the realization)

**Particle**:
A single client-side visual speck with sub-cell position, velocity, and
lifetime, simulated at render framerate. One VisualEffect spawns many using
local randomness — specks differ harmlessly between clients. Behaviour comes
from its **ParticleType** profile.
_Avoid_: sprite, pixel, FX

**ParticleType**:
The declarative profile behind a named particle effect (`blood`, `gore`,
`impact`, `levelup`…): gravity, bounce, rest/fade, visuals, count. Engine-
internal — the particle engine's only public surface is the named effect
(`spawn('blood', at, dir, intensity)`).
_Avoid_: CombatEvent.kind, ParticleKind

**Damage number**:
The floating digits popped by a damaging `hit`/`break` — client-side,
deterministic (no local randomness), drifting up from the target. The
attacker's own number comes from its predicted `hit` and is *converted* when
the authority resolves that swing as a `break`. Block chip shows no number.
_Avoid_: Floating combat text, damage popup, hit marker

**Hitstop**:
A render-only freeze of a few dozen milliseconds on a Poise break — the sim
never pauses; only the redraw is gated.
_Avoid_: pause, freeze-frame, slow-mo

**Camera-kick**:
A small decaying viewport offset (≤2 cells, <150ms) on a big moment, quantized
to one Pixel. A single directional punch, not a rumble.
_Avoid_: screenshake, rumble

**SoundEffect**:
The client-side audible realization of a moment — fed by CombatEvents
(spatialized from the *Player's* position, not the camera) or purely local
interactions (your own jump; flat and centred). Best-effort: with no audio
device every SoundEffect is a silent no-op.
_Avoid_: Cue, audio (reserve for the engine/files)

**Monster**:
A hostile, server-controlled entity Players fight for XP and loot.
_Avoid_: Mob, enemy, NPC, creature

**NPC**:
A non-hostile, server-controlled character. Never fought.
_Avoid_: Vendor, bot

**Brain**:
The decision function controlling a Monster each tick: it perceives a limited
view and produces a **Drive** — nothing else. Never applies damage or moves
anything; every consequence flows through **Strike** resolution. Composed
from the shared **Skeleton** plus a **Movement engine** and **Combat engine**,
with private typed memory the wire never sees.
_Avoid_: AI, behavior script, controller

**Skeleton**:
The one Patrol/Combat state machine every Brain runs: gates → perceive →
transition → delegate. It alone reads/writes the state; engines receive it.
A Monster enters Combat within **vision** and (deliberately, for now) exits
the moment outside it.
_Avoid_: State machine (too generic), base brain

**Movement engine**:
The pluggable gait half of a Brain — wandering and moving toward a
destination (walking with wall/ledge probes; the Slime's hopping). Never
chooses destinations in Combat; the Combat engine leads and calls it.
_Avoid_: Locomotion, movement AI

**Combat engine**:
The pluggable fighting half of a Brain — its attack pattern. Two-sided: the
decision half emits Drives; the execution half is the hooks the zone tick
calls after a commit (committed-body control, timers, Strike/Projectile
construction). Swing (chaser, **Brute**), fire (**Ranged poker**), pounce
(**Slime**). Stats include **vision** (perception radius) and **range**
(interpreted per engine).
_Avoid_: attack script, combat AI; aggro (use vision), reach (use range)

**Melee committer**:
A Monster archetype dealing damage *only* through a telegraphed melee Attack
phase. Monsters have **no passive contact damage**: overlap does nothing, so
every point of incoming damage was dodgeable/punishable.
_Avoid_: Melee mob, contact damage

**Slime**:
The introductory hopping archetype whose attack is a ballistic **pounce** —
arc locked at commit, the leaping body is the live hitbox, punishable landing
wobble. Traversal hops are harmless locomotion.
_Avoid_: Leaper, blob

**Chaser**:
The walking Melee committer — approach on foot, telegraphed swing.
_Avoid_: Slime (that's the hopping archetype), walker

**Brute**:
The heavy Melee committer of the deep Field — slow, high-**Poise**, heavy
**Mass**, hits hard, long punishable openings between deliberate commits.
_Avoid_: Tank, heavy mob, boss

**Ranged poker**:
A Monster archetype fighting at distance, firing exactly one Projectile on
its active frame — never auto-firing. The wind-up is the cue to Dodge, Block,
swat, or close in.
_Avoid_: Archer, turret, hitscan mob

**Projectile**:
A first-class hit that travels — same hit-reaction payload as a melee swing
(damage + poise + Knockback), reactable speed, resolved through the same
Strike path. Countered by **Dodge**, **Block**, or **swat**.
_Avoid_: Bullet, missile, hitscan

**swat**:
Destroying a hostile Projectile with a melee active frame — a light clink,
nothing reflected.
_Avoid_: Deflect, parry, reflect

**Combat**:
Real-time PvE fighting built on **commitment**: an attack occupies time in
phases, so *when* you commit is itself a skill. Clients send intents and
predict their own actions; the server resolves every outcome. The tick is
**project-then-resolve**: per-entity passes advance state and emit
**Strike**s; one resolve pass lands every Strike by the **Faction**-gated
uniform rule.
_Avoid_: Fighting, battle, tab-target

**Strike**:
A projected attack handed from a project pass to the resolve pass — "this
hitbox deals this HP + Poise damage, facing →, for this Faction." Never
applied where it is made; resolved against overlapping, hittable,
opposing-Faction, not-already-hit victims. The per-swing dedup ledger lives
on the attacking entity, not the Strike.
_Avoid_: Hit (the resolved contact), Attack, Hitbox

**Faction**:
The allegiance key — `players` | `monsters` — gating which entities a Strike
may resolve against. Makes PvE hold by construction: Avatars share a Faction,
so no Avatar ever damages an Avatar.
_Avoid_: Team, side, alliance

**Attack phase**:
The three stages of every attack: **wind-up** (committed, telegraphed) →
**active** (hitbox live) → **recovery** (vulnerable).
_Avoid_: Animation, frame, swing-state

**Poise**:
An entity's accumulating resistance to being staggered. Attacks deal poise
damage; only a *break* staggers. Regenerates under no pressure; spikes during
a wind-up (**Super-armor**).
_Avoid_: Posture, stability, stagger meter

**Stagger**:
The reaction state on a Poise break — **Hitstun** plus **Knockback**.
Triggered by a break, never by damage alone.
_Avoid_: Stun, flinch

**Hitstun**:
How long a Staggered entity is locked out of action. Control is locked,
physics is not.
_Avoid_: Stun, freeze, lock

**Knockback**:
The impulse a hit imparts on Stagger, scaled by the victim's **Mass**. Tuned
snappy/arcade, not floaty.
_Avoid_: Pushback, recoil

**Mass**:
An entity's resistance to Knockback distance.
_Avoid_: Weight

**Momentum body**:
The single physics body every entity integrates each tick (`position +
velocity + Mass`): drive + impulses + gravity − drag, then shared
axis-separated Terrain collision. Monsters are airborne-capable on it with no
special case.
_Avoid_: Rigidbody, character controller

**Drive**:
The per-tick movement decision fed into the physics step — move direction,
jump, optionally an attack commit. Produced from a Player's **Intent** or a
Monster's **Brain**; the simulation doesn't care who is driving.
_Avoid_: Input (raw keys), Intent (the client→server bundle), command

**Super-armor**:
The temporary Poise spike held during a wind-up.
_Avoid_: Hyper-armor

**Guard**:
The unified frontal-arc defensive stance — raisable only with a **Shield**
equipped. Any raised Guard is a **Block**. Hits from behind ignore it.
_Avoid_: Defend, stance

**Block**:
Holding Guard to absorb a frontal hit for chip damage, draining Poise toward
a guard-break. Gated solely by an equipped Shield — no level unlock.
_Avoid_: Shield (the Item), brace

**Shield**:
The **Offhand** Item whose being equipped enables Guard — the one deliberate
exception to "loot never changes playstyle." Stat-less for now; composited
onto the Avatar at the Form's `offhand` **Anchor**, switching to a held-state
`block` Animation while guarding.
_Avoid_: Offhand weapon, buckler

**Offhand**:
The fourth equipment Slot (`weapon | armor | accessory | offhand`), holding a
Shield.
_Avoid_: Shield slot

**Guard-break**:
The Stagger a Block suffers when sustained chip drains its Poise — turtling
punished by the same accumulating-Poise system, not a separate meter.
_Avoid_: Shield-break

**Dodge**:
A short horizontal hop granting brief i-frames, with committal recovery.
_Avoid_: Roll, dash, evade

**Dodge after-image (echo)**:
The cyan ghost trail a Dodge leaves at its launch spot — a client visual on
its own render clock, decoupled from the i-frame timing it illustrates.
_Avoid_: Trail, smear

**Active skill**:
A slotted, cooldown-bound special move (Power Strike, Ground Pound) fired on
its own input.
_Avoid_: Ability, spell

**Weapon stat block**:
What an equipped Weapon Item contributes: **damage**, rolled **Affixes**, and
visuals (Weapon sprite + accent colour). Every weapon swings the one shared
moveset — a weapon never changes playstyle (the Shield is the sole
exception); loot variety is stats and looks.
_Avoid_: Weapon type, weapon class; per-weapon feel (removed)

**Weapon sprite**:
The animated art of an equipped Weapon, composited at its **grip anchor**
every frame — present at rest, not only when swinging. Its `swing` Animation
is exactly three frames indexed by Attack phase.
_Avoid_: Weapon overlay, swing effect

**Grip anchor**:
The named "hand" cell a body declares for hanging a Weapon sprite; mirrors
with facing. Keeps weapon placement in data, not draw code.
_Avoid_: Mount point, hardpoint

**Weapon accent**:
The single per-Weapon colour driving its blade highlight and swing arc — the
rarity-ready seam: tier colours feed this channel with no rework.
_Avoid_: Tint

**Intent**:
The per-tick bundle of what an Avatar is trying to do, reported by the client
and resolved authoritatively: kinematics plus attack/skill/interact requests.
Distinct from a discrete request (Chat, sell/buy) — a one-shot message with
its own handler.
_Avoid_: Command, action, input

**Authority model**:
Client owns its Avatar's movement (uncontested, loosely sanity-checked);
server owns every consequence — Monster HP, hit resolution, loot, XP,
inventory, Gold. Cheating the economy requires breaking the server.

**Class**:
An Avatar's role archetype determining skills and combat style. Warrior only
for now; Archer/Mage planned.
_Avoid_: Job, profession, build

**Item**:
Equippable gear = base type + rarity tier + randomized affixes. Rarity is
shown as colour — the core visual language of loot. Slots: Weapon, Armor,
Accessory, Offhand.
_Avoid_: Equip, gear, loot

**Drop**:
An Item resting in the world where a Monster died — collected on touch, fades
if left. Private: loot is instanced, so only its owner ever sees it. Rendered
as a rarity-coloured glyph with a floating label.
_Avoid_: Loot pile, pickup item

**Loot table**:
The per-Zone drop rules, keyed by Zone id: droppable bases, drop chance (the
Dungeon is the 100% faucet; Fields drop occasionally), optional rarity
re-weighting. Pure data over the shared seeded roll logic.
_Avoid_: Drop table, spawn table

**Gold**:
The single currency. Drops from Monsters; earned by selling to Merchants.
_Avoid_: Coins, money, credits

**Server-authoritative economy**:
Every Gold-and-Item transaction resolves on the server, never trusted from
the client. A client sends only an intent ("sell item #7"); the server
re-derives the price, verifies ownership, and gates on proximity — invalid
requests are silent no-ops. Authoritative Gold/inventory ride the snapshot;
the client never mutates its balance optimistically.
_Avoid_: Client-side shop, optimistic economy

**Merchant**:
The Town NPC whose interact opens the shop overlay to sell loot and buy
starter goods. Prices sit above sale value so the shop is a sink, never a
faucet.
_Avoid_: Shopkeeper (the mechanic), store

**Instanced loot**:
Every contributor to a kill earns XP and rolls its own private Drops — no
shared pile, no kill-stealing; other hunters are help, not competition.
Player death is forgiving: respawn in Town, no XP or Item loss.
_Avoid_: Loot share, kill credit

**Terrain**:
The solid geometry — the only thing entities collide with (Avatars pass
through each other). Real-time platformer movement. Two solid tile kinds:
**Wall** and **One-way platform**.
_Avoid_: Tiles, collision map

**Wall**:
A fully solid tile — glyph `#`, cell value `1`. Blocks every side; the world
bounds read as walls.
_Avoid_: Solid, block

**One-way platform**:
A tile you can stand on but also pass through — glyph `=`, cell value `2`.
Vertically like any solid (land on top, rise through); horizontally
transparent. Authored per tile.
_Avoid_: Ledge, semisolid

**Sweep**:
The physics module's terrain-collision primitive: what does a point
travelling A→B hit? Axis-separated, checks every crossed cell (no
tunneling), carries the one-way rule. Both integrators and the Particle sim
resolve terrain through it — one answer to "what blocks a moving point."
_Avoid_: Raycast, trace

**Interact edge**:
The `interact` intent as a one-shot edge: latched on the client until the
next send, consumed once per server tick — a press enters a Portal exactly
once even when the arrival overlaps the return Portal.
_Avoid_: Interact flag, use key

## Zone authoring

**Zone editor**:
The forge TUI (`zone edit <id>`) for painting Terrain and placing entities,
rendered through the same renderer the game uses. Operates on the lossless
raw document, never a parsed Zone.
_Avoid_: Level editor, map editor

**Placeable**:
A thing the Zone editor places: a Terrain kind, a catalog entity (by id), or
a Structure (Portal). The author works in Placeables, never glyphs — the
editor owns the glyph↔Placeable mapping, so orphan glyphs are
unrepresentable.
_Avoid_: Glyph, stamp, tile

**Palette**:
The set of Placeables on offer, generated from the catalogs — never
hand-maintained. The editor consumes the catalog; it never edits it.
_Avoid_: Toolbar, brushes

**Tool**:
The interaction verb bound to the cursor — what a click or drag does.
_Avoid_: Mode

## Sprite authoring

**Sprite file**:
The `.sprite` asset file that *is* a sprite's source of truth: visible glyph
art plus metadata — an ordered array of named Animations of unnamed Frames,
Anchors, colors, per-Animation fps. One format for every sprite shape;
identity is the filename, the directory names the **Sprite role**.
_Avoid_: Asset, sprite sheet

**Sprite role**:
What a Sprite file is for — form, hat, weapon, shield, monster — named by its
directory and driving its validation profile. Cosmetic roles register by
directory scan (the file existing makes it pickable); combat-entity roles are
the art half of a catalog entry referencing the file by id.
_Avoid_: Type, kind

**Sprite editor**:
The forge TUI (`sprite edit`) for drawing art in **Pixel**s, compiled to
half-block glyph grids — WYSIWYG through the shared renderer, with playback
and the **Composited preview** built in. An inexpressible cell is
auto-resolved at paint time with feedback, never silently quantized at
export.
_Avoid_: Paint program

**Frame**:
One glyph grid — the unit the editor paints and an Animation orders. Frames
are unnamed, identified by animation + index.
_Avoid_: Cel, frame name (retired)

**Default frame**:
Frame 0 of the first Animation — every sprite's first-class citizen (a form's
`idle`, a weapon's rest frame, a hat's only frame). It owns the file-level
Anchors; edits on any other frame author per-frame overrides. Monster/NPC
logical boxes derive from its visible pixel bounds.
_Avoid_: Base frame, rest frame

**Pixel**:
The editor's atomic unit — one quadrant sub-cell, four per terminal cell,
each a color or transparent. A cell carries at most two colors (fg + bg) —
the medium's grain. Movement-capable roles are Pixel-only so their art
translates at half-cell resolution without snapping apart.
_Avoid_: Cell (the 2×2 group), dot

**Glyph stamp**:
The secondary Tool placing one arbitrary single-column character into a cell
for art the pixel model cannot express. Cell-aligned, immune to pixel
painting until cleared.
_Avoid_: Text tool

**Anchor**:
A named cell for attaching overlays — `grip` hangs the Weapon sprite, `head`
the hat, `offhand` the Shield; names are open. An anchor is an *offset* (any
integer, negatives legal; out-of-bounds is a warning, never an error).
File-level anchors live on the Default frame; other frames may override.
_Avoid_: Mount point, slot

**Composited preview**:
The in-context render of a sprite as the game will draw it — hat on body,
weapon in hand across its swing — through the shared renderer.
_Avoid_: Mannequin, test render

**Preview stance**:
The Composited preview's scenario — facing plus what the mannequin is doing.
A selection *across* sprites, which is why it is not itself an Animation.
_Avoid_: preview mode
