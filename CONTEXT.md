# Terminal Side-Scroller MMO

A persistent **PvE side-scrolling MMORPG** played entirely inside a terminal (TUI).
One big shared, persistent World (no instancing). Players control customizable
avatars, hunt monsters on platforming maps for XP / levels / loot, and gather in
social town hubs. Real-time combat is a first-class pillar. PvP and faction-war are
out of the core (parked). The audience is developers and CLI-native users.
Mental-model reference point: "MapleStory in a terminal." Built as a pet project to
experiment, have fun, and show off — so the guiding value is coolness-per-unit-effort
and a demoable slice, not feature completeness.

## Language

**Player**:
A human participant / account. The person at the keyboard.
_Avoid_: User, gamer

**Avatar**:
The in-world character a Player controls and customizes; one Avatar per Player.
Rendered as an **expressive multi-row ASCII-art figure** (~4–6 rows, roughly the
level of detail of the Claude mascot), NOT a single glyph or 2-cell blob.
Customizable via: a chosen color/hue, one cosmetic accessory slot (e.g. hat;
cosmetic-only, separate from gear stats), and a nameplate (name + color).
_Avoid_: Character, hero

**Sprite**:
The visual ASCII-art representation of an entity (Avatar, Monster, NPC). Purely
decorative and client-side; deliberately decoupled from the entity's small
logical collision/hitbox footprint (see ADR on visual architecture).
_Avoid_: Art, model, skin

**World**:
The single, persistent, shared space that all Players inhabit. There is one
*logical* World. Under load, an individual Zone may transparently split into
multiple Channels — that is the only form of instancing, and it is server-managed.
The World is partitioned into Zones.
_Avoid_: Server, realm, map (reserve "map" for nothing — it's too overloaded)

**Zone**:
A discrete, bounded area of the World — a side-scrolling locale that may span
several screens (a camera follows the Avatar). An Avatar occupies one Zone at a
time and moves between Zones via connections (portals/edges). The unit of "place"
AND the unit of server simulation (each Zone runs its own tick; Zones are
independent, enabling later distribution across processes). It is also the unit of
*interest*: a Player only receives real-time updates about entities in their own
Zone (and Channel). Two kinds: Town and Field.
_Avoid_: Map, level, room, screen

**Zone id**:
A Zone's stable identity — derived from its filename (`zones/<id>.zone`), NOT a
field stored in the file. It is what every Portal `target` references. Renaming a
Zone means renaming the file (and rewriting referencing Portals); identity is the
path, so it can never drift from a duplicated header field.
_Avoid_: Name, slug (reserve "name" for the display label)

**Zone name**:
A Zone's human-facing display label ("Verdant Field"), distinct from its id — a
label, not an identity (cf. Handle). Optional, decorative, editable in the Zone
editor. Never used to address or resolve a Zone.
_Avoid_: Title, id

**Channel**:
A parallel instance of a single Zone, created automatically by the server when
that Zone reaches its soft population cap. Players in different Channels of the
same Zone cannot see each other. Channeling is server-managed (routed on Zone
entry, not chosen by the Player) and consolidated automatically as population
drops. Matters most for Towns, where population converges.
_Avoid_: Instance, shard, room, server

**Town**:
A safe social Zone with no monsters — where Players gather, show off avatars,
trade, and regroup. The "hub."
_Avoid_: City, hub, lobby

**Field**:
A combat Zone populated by Monsters, where the hunting/progression loop happens.
_Avoid_: Hunting map, dungeon, level

**Handle**:
The ephemeral display label a Player is known by in the social layer — painted on
the nameplate and attributed on each Chat message (set at connection, per ADR
0006). A *label, not an identity*: it carries no uniqueness guarantee and must
never be used to address an entity. The session id is identity.
_Avoid_: Username, nick, name, identity

**Chat**:
Real-time text communication between Players. The first form is **Zone chat**: a
message is relayed to every session in the sender's Zone *and* Channel and shown
in each recipient's chat log, attributed to the sender's Handle. (Whisper and
emote come later.)
_Avoid_: Say, talk, message

**Speech bubble**:
The ephemeral, bordered text that floats above a chatting Avatar's head, showing
their latest Chat message to everyone who can see that Avatar. A purely
client-side, decorative rendering of a Chat message (like a Sprite): it attaches
to the Avatar by session id, tracks the Avatar as it moves, and expires on a
timer — the chat log stays the durable record.
_Avoid_: Chat bubble, balloon, callout, tooltip

**CombatEvent**:
The resolved, *semantic* fact of a combat interaction — "target T was **hit** /
**broke** (poise) / **died** / **parried**, at (x,y), facing →, intensity N." It is
what Combat resolution produces; an **Effect** is its presentation projection (via
the shared `effectsOf`), and a **Particle** is the Effect's realization. The
authority *produces* a CombatEvent by applying damage/poise (the poise result is
what makes a contact a hit vs a break vs a death); the local Player *predicts* only
the optimistic `hit` event from contact, for zero-latency feedback. `break`/`death`/
`parry` are authority-only. Distinct from Effect: a CombatEvent's `kind` is the game
fact (`hit`), an Effect's `kind` is the look (`blood`). Shared-internal, never on the
wire — it is projected to Effects before the snapshot is built (see ADR 0019).
_Avoid_: Effect (that's the projection), HitEvent, Outcome

**Effect**:
A small, authoritative descriptor of a momentary world event worth showing —
e.g. "a blood-hit landed at (x,y), facing →, intensity N." The **presentation
projection of a CombatEvent** (`effectsOf`), produced deterministically in shared
logic the moment Combat resolves, and broadcast to every session in the Zone (like
an Emote) *except* the session that caused it (which predicts it locally). An Effect
says *what it looks/sounds like*; the CombatEvent it came from says *what happened*.
Its visual realization is the client's business (see Particle). The local Player
predicts their own Effects client-side for zero-latency feedback; the server derives
the same Effects independently and authoritatively.
_Avoid_: Event (too generic — see CombatEvent), FX, animation, particle (that's the realization)

**Particle**:
A single client-side visual speck — one cell with a sub-cell position,
velocity, and lifetime — simulated locally at render framerate. A client turns
one Effect into many Particles using local randomness, so the exact specks
differ harmlessly between clients; only the Effect is shared. Each Particle's
motion and look (gravity, bounce, whether it rests, glyphs, color-over-life) come
from its **ParticleType**, not from hardcoded blood behavior. Purely decorative
and client-side, like a Sprite.
_Avoid_: Effect, sprite, pixel (ambiguous), FX

**ParticleType**:
The visual profile a Particle belongs to (`blood`, later `dust`, `sparkle`,
`spark`…) — a declarative data entry defining its whole behavior: gravity,
bounce, terrain collision, rest and fade durations, glyph sets, color-over-life,
z-layer. One generic client simulator reads the profile, so a new look is a new
data entry, not new code. Distinct from `Effect.kind`: an Effect.kind is the
*semantic game event* ("blood hit"), mapped client-side to one or more
ParticleTypes — the indirection that lets one event spawn several looks.
_Avoid_: Effect.kind, ParticleKind, sprite

**Hitstop**:
A client-side, render-only freeze of a few dozen milliseconds on a meaty hit (a
Poise break), holding the last drawn frame so the blow lands with weight. The
**sim never pauses** — the shared step keeps advancing authoritatively; only the
playfield's redraw is gated, so positions catch up the instant the freeze drains.
View-only and non-authoritative, like a Particle; the server has no concept of it.
_Avoid_: pause, freeze-frame (the *sim* doesn't freeze), slow-mo, lag

**Camera-kick**:
A small, decaying viewport offset (≤2 cells, gone in <150ms) the client adds on a
"big moment" — a Poise break in the foundation — layered on top of the follow
camera as a single directional punch (not a rumble; micro-shake reads as jank at
cell granularity). View-only and non-authoritative; keyed off the `impact`
**Effect**, so it fires for everyone who sees the break, attacker included.
_Avoid_: screenshake, rumble, camera shake (it's a single decaying pop)

**Lag compensation**:
The server judging a timing defense (a **Parry**) against the Player's own delayed view,
not raw server time (ADR 0017 §11). Each input carries a client timestamp; the server
estimates how late it arrived and widens the Parry window by that slack (capped) so a
catch timed right on the Player's screen still resolves when the input lands a tick or
two late. A bounded tolerance, **not** rollback (rejected: too heavy for a persistent
many-entity World) — windows are authored in ticks, deliberately chunky to absorb the
30 Hz quantization the comp can't.
_Avoid_: rollback, netcode rewind, prediction (that's the client side)

**SoundEffect**:
The client-side *audible* realization of a moment — the audio twin of a Particle.
Where a Particle answers *what it looks like*, a SoundEffect answers *what it
sounds like*. Two sources feed it: an authoritative **Effect** / death (so a
nearby Avatar's hit or death is heard, spatialized by position) and a purely
local interaction (your own jump, a menu blip — never on the wire). Always
best-effort and non-authoritative: if there is no audio device, every SoundEffect
is a silent no-op and the World behaves identically. The shared sim never
references one — like a Sprite or Particle, it is the client's business alone.
_Avoid_: Cue, sound, audio (reserve for the engine/files), Effect (that's the
authoritative trigger, not the audible result), FX

**Monster**:
A hostile, server-controlled entity that Players fight for XP and loot. Lives in
Fields.
_Avoid_: Mob, enemy, NPC, creature

**NPC**:
A non-hostile, server-controlled character (shopkeeper, quest-giver, etc.).
Distinct from Monster — NPCs are never fought.
_Avoid_: Vendor, bot

**Melee committer**:
A Monster archetype that deals damage *only* through a telegraphed melee **Attack
phase** — approach/space → **wind-up** (committed, replicated for the Player to
read) → **active** (the one damaging window) → **recovery** (a punishable opening,
it cannot re-commit or cancel). The reworked chaser is the first one. Monsters have
**no passive contact damage**: overlapping a Monster does nothing, so every point of
incoming damage was dodgeable/punishable. See ADR 0017 §9.
_Avoid_: Melee mob, contact damage, walk-into-you damage

**Ranged poker**:
A Monster archetype that fights at distance — the reworked shooter. Like the **melee
committer** it deals damage *only* through a telegraphed **Attack phase**: it
maintains distance, and on a commit runs the same **wind-up** → **active** →
**recovery** swing, **firing exactly one Projectile on the active frame** (never
auto-firing). The wind-up is the Player's cue to **Dodge**/**Block**/**Parry** the
shot or close in to punish the recovery. See ADR 0017 §8.
_Avoid_: Archer, turret, auto-shooter, hitscan mob

**Projectile**:
A **first-class hit that travels** — not a special-case ranged poke. It carries the
*same* hit-reaction payload a melee swing does (**HP damage** + **poise damage** +
**Knockback**), so a heavy shot **Staggers** on a **Poise** break exactly like a
melee connect while a pebble only chips, and it resolves through the same hit path.
It travels at a **reactable** speed (not hitscan). Countered by the whole defensive
kit: **Dodge** through it (i-frames), **Block** it (chip + poise drain), **Parry to
reflect** it, or **swat** it with a melee active frame. See ADR 0017 §8.
_Avoid_: Bullet, missile, hitscan

**Reflect**:
The result of **Parrying** a **Projectile**: the shot reverses and becomes *yours*
(now owned by the parrier), flying back to threaten the shooter — the ranged
counterpart to a melee Parry's punish opening. Distinct from a **swat**, which
*destroys* a shot with a melee active frame (no reflect). See ADR 0017 §8.
_Avoid_: Deflect, return, bounce

**Combat**:
Real-time PvE (Player vs Monster) fighting — a first-class pillar, not flavor.
Built on **commitment**: an attack is not instant but occupies time in **phases**,
so *when* you commit is itself a skill. **Positional / directional hitbox** model;
melee aim is **contextual and forgiving** (a wide frontal arc, plus a vertical
**Launcher**/**Spike**), ranged is **precise** (directional projectiles; mouse-aimed
for ranged Classes later). Skill expression lives in timing (**Parry**, **Dodge**)
and **Knockback**-driven **Juggles**, all regulated by **Poise**. Clients send
*intents* and predict their own actions; the server resolves every outcome
authoritatively (hit, damage, kills, loot). The combat slice of an Intent
(attack/skill) is gated by a single shared resolver (`resolveCombat`) that both
the authoritative server step and the client's optimistic telegraph run, so they
can never gate a swing or skill differently. See ADR 0017.
_Avoid_: Fighting, battle, PvE, tab-target (use "Combat")

**Attack phase**:
The three stages every attack — Player or Monster — passes through: **wind-up**
(committed, telegraphed, interruptible), **active** (hitbox live), **recovery**
(vulnerable, no act except a combo cancel). A "wind-up attack" is just the
long-wind-up end of the spectrum, not a separate kind of attack.
_Avoid_: Animation, frame, swing-state

**Poise**:
An entity's accumulating resistance to being staggered. Attacks deal **poise
damage**; only when the pool *breaks* does a hit **Stagger**. It regenerates under
no pressure and spikes during a wind-up (**Super-armor**). This is why weak
Monsters never stagger you and strong ones only occasionally do.
_Avoid_: Posture, stability, balance, stagger meter

**Stagger**:
The reaction state an entity enters the moment its **Poise** breaks — **Hitstun**
plus **Knockback** — leaving it open to a combo. Triggered by a poise break, never
by damage alone.
_Avoid_: Stun, flinch, stunlock

**Hitstun**:
How long a **Staggered** entity is locked out of action. Control is locked but
physics is not — the body still flies under **Knockback** and gravity, which is
what being comboed feels like.
_Avoid_: Stun, freeze, lock

**Knockback**:
The impulse a hit imparts to the victim's momentum on **Stagger** — a shove, a
launch, or a spike. Scaled by the victim's **Mass**. Tuned snappy/arcade, not
floaty.
_Avoid_: Pushback, recoil, impulse

**Mass**:
An entity's resistance to **Knockback** distance — the same **Launcher** rockets a
light Slime across the screen but barely lifts a heavy ogre.
_Avoid_: Weight, heaviness

**Momentum body**:
The single physics body every entity — Avatar and Monster alike — integrates each
tick (`position + velocity + Mass`): input drive + external impulses + gravity −
drag, then the shared axis-separated Terrain collision. **Knockback** is just an
impulse fed into it, so a shove decays under drag and a launch arcs under gravity
on the same path that walks and jumps. Monsters are airborne-capable on it with no
special case (`stepEntity` in `physics.ts`).
_Avoid_: Rigidbody, actor, character controller

**Super-armor**:
The temporary **Poise** spike an entity holds during a wind-up, letting a heavy
attack shrug off light hits without being interrupted.
_Avoid_: Hyper-armor, armor (reserve for gear)

**Launcher**:
An attack (`up` + attack) that **Knocks** a poise-broken target upward and pops the
attacker up to follow — the entry into an aerial **Juggle**.
_Avoid_: Uppercut, pop-up

**Spike**:
An airborne attack (`down` + attack) that drives a **Juggled** target back down to
the ground.
_Avoid_: Slam, down-air, ground-pound (that is an active skill)

**Juggle**:
Keeping a **Staggered** target airborne with successive hits. Bounded by **combo
decay** (each hit adds less **Hitstun** and the target falls faster) so it
self-terminates back to neutral — never infinite.
_Avoid_: Air combo, loop, infinite

**Guard**:
The unified, frontal-arc defensive stance. The opening window of a guard-raise is a
**Parry**; held past that window it is a **Block**. Hits from behind ignore it.
_Avoid_: Defend, stance, shield

**Block**:
Holding **Guard** to absorb a frontal hit for chip damage, draining **Poise** toward
a guard-break. The safe, low-skill defense, available from level 1.
_Avoid_: Shield, brace

**Guard-break**:
The **Stagger** a **Block** suffers when sustained chip drains its **Poise** pool to a
break — turtling punished by the same accumulating-Poise system as any other break, not
a separate guard meter. Distinct from a **Parry**, which spends no Poise.
_Avoid_: Shield-break, stun

**Parry**:
A hit caught in the opening window of a **Guard** — it negates the hit, dumps
**Poise** damage onto the attacker (opening a punish), and **reflects** a
projectile back at its source. The high-skill defense, an earned unlock.
Deflecting a projectile is a Parry.
_Avoid_: Deflect, riposte, counter, block (that is the held version)

**Dodge**:
A short horizontal hop granting brief invulnerability (i-frames) with committal
recovery — the mobility-defense, available from level 1.
_Avoid_: Roll, dash, evade

**Dodge after-image (echo)**:
The cyan ghost trail a **Dodge** leaves at its launch spot — a short string of
fading silhouettes of the Avatar's own sprite, planted where the hop began and
trailing opposite the hop. Purely a **client visual effect** with its own render
clock: spawned on the dodge-start edge and decoupled from the i-frame timing it
illustrates (ADR 0017 §13). Not part of the sim and never on the wire.
_Avoid_: Trail, smear, blur (reserve "echo" for this)

**Moveset ability**:
A passive, no-cooldown extension of what the attack button does — string
extensions, the **Launcher**, aerials, the **Spike**, cancels, the **Parry** —
unlocked by level (and later **Class**). Distinct from an **Active skill**; it is
*how your character moves*, not a thing you fire.
_Avoid_: Skill (reserve for active), passive, combo move

**Active skill**:
A slotted, cooldown-bound special move (e.g. Power Strike, Ground Pound) fired on
its own input. Distinct from a passive **Moveset ability**.
_Avoid_: Ability, spell, move

**Weapon stat block**:
The data an equipped Weapon **Item** contributes to combat and visuals (ADR 0017
§14): damage, arc size (melee reach), **Poise** damage, **Knockback**, and the
**Attack phase** durations (phase-speed), plus its **Weapon sprite** and an optional
**Trail**. Drives a greatsword's slow-and-heavy feel vs a dagger's fast-and-light
one through the *same* resolution path — no per-weapon special-casing. The
weapon's catalog index joins the Avatar's replicated appearance, so others see
your weapon. All weapons share the one Warrior **Moveset** for now.
_Avoid_: Weapon type, weapon class (reserve **Class** for the Avatar archetype)

**Trail**:
A short-lived particle streak that follows a **Weapon**'s blade through its
**active** phase (ADR 0017 §14), defined per-weapon by a key the client resolves
to a ParticleType — the same shared-owns-the-fact / client-owns-the-pixels seam as
an Effect. Purely visual; absent on a weapon means no trail. One of the three
layers of a swing alongside the **Weapon sprite** sweep and the **Blade-edge arc**.
_Avoid_: Swoosh, slash effect (reserve **Blade-edge arc** for the tip-tracing glyphs)

**Weapon sprite**:
The animated ASCII-art of an equipped **Weapon**, composited onto the **Avatar**
every frame at its **grip anchor** — present at rest, not only when swinging (ADR
0018). Unlike a single-frame **Sprite**, it is a named frame set: `idle`, `windup`,
`active` (an ordered sweep sampled by **Attack phase** progress), `recovery`. The
frame is a pure function of `(move, phase, progress)`, so the owner's prediction and
every observer's render agree. Heft comes from phase *durations*, not frame count.
_Avoid_: Weapon overlay, swing effect (it is part of the Avatar, not an effect)

**Grip anchor**:
The named "hand" cell a body template declares for hanging a **Weapon sprite** —
the weapon's own grip cell aligns to it, and it mirrors with facing, the same
data-driven anchor mechanism the cosmetic hat uses for the head cell (ADR 0018).
Keeps weapon placement out of imperative draw code.
_Avoid_: Hand slot, mount point, hardpoint

**Blade-edge arc**:
The short, fading smear of curve glyphs that traces a **Weapon**'s blade *tip*
through its **active** phase, so the eye reads a swing's speed and direction (ADR
0018). Authored as part of the **Weapon sprite** animation, not a hitbox overlay —
it replaces the retired `///` **hitbox** box-fill, which is no longer drawn.
_Avoid_: Slash-arc, slash, swing fill (the legacy hitbox-fill, now retired)

**Weapon accent**:
The single per-**Weapon** colour that drives its blade highlight, **Blade-edge
arc**, and **Trail**, so a weapon reads as a distinct object even at rest (ADR
0018). The rarity-ready seam: when loot rolls rarity tiers, the tier colour feeds
this same channel with no rework. The weapon's structural palette (grip, guard) is
authored separately on the sprite; the accent is the one dynamic channel.
_Avoid_: Tint, weapon colour (reserve for the static sprite palette)

**Intent**:
The per-tick bundle of what an Avatar is trying to do, reported by the client
and resolved authoritatively by the server (ADR 0001): the Avatar's reported
kinematics (position/velocity/facing/onGround) plus its combat (attack, skill)
and interact requests for that tick. Continuously sampled and idempotently
gated each tick (cooldowns / i-frames stop a double-apply). Distinct from a
discrete request action — Chat, Trade, item use — which is a one-shot, apply-
exactly-once message with its own authoritative handler, never a per-tick Intent
field.
_Avoid_: Command, action, input (reserve "input" for the raw client-side keys)

**Authority model**:
Client owns its Avatar's movement (broadcast + loose server sanity-check, safe
because positions are uncontested). Server owns every *consequence* — Monster
HP, hit resolution, loot, XP, inventory, currency, trades. Cheating the economy
requires breaking the server, not the client.

**Class**:
An Avatar's role archetype, chosen at creation, determining its skills, stat
focus, and combat style. Planned set: Warrior (forgiving melee), Archer (precise
ranged), Mage (ranged AoE/utility). MVP ships **Warrior only**; the others come
once the loop is fun.
_Avoid_: Job, profession, role, build

**Item**:
An equippable piece of gear = **base type** (e.g. `Iron Sword`) + **rarity tier**
+ a small set of **randomized affixes** (rolled stats). Rarity is shown as color
— the core visual language of loot. Dropped by Monsters or bought from NPC
vendors. MVP slots: Weapon, Armor, Accessory. (Non-gear items like consumables
may come later.)
_Avoid_: Equip, gear, drop, loot (use "Item")

**Gold**:
The single currency. Drops from Monsters; earned by selling Items to NPC vendors.
Spent on Trade, the Auction House, and NPC purchases.
_Avoid_: Coins, money, currency, credits

**Trade**:
A direct, face-to-face, both-sides-confirm Item/Gold swap between two Players in a
Town. Server-authoritative and atomic.
_Avoid_: Swap, exchange, deal

**Auction House**:
A global asynchronous market where Players list Items for Gold; the server escrows
listed Items and Gold. Coexists with Trade. Post-MVP. Bots/RMT are explicitly a
non-concern (open-source, for-fun).
_Avoid_: Market, AH, marketplace, exchange

**Instanced loot**:
When multiple Players damage a Monster, every contributor earns XP and rolls their
*own* private Item drops — there is no shared loot pile. Eliminates kill-stealing
and makes other hunters in a Field feel like help, not competition. (Player death
is forgiving: respawn in Town, no XP or Item loss at MVP.)
_Avoid_: Loot share, drop table (per-player), kill credit

**Terrain**:
The solid geometry of the world (platforms, walls, ground, ropes/ladders) — the
only thing Avatars physically collide with. Avatars do NOT collide with each
other; they pass through one another freely. Movement is a real-time platformer
(gravity + jumping).
_Avoid_: Tiles, level, collision map

**Hacking (sub-theme)**:
Developer/hacker-culture flavor that may inspire some mechanics. Explicitly NOT
the core verb of the game — parked until the core spine exists.

## Zone authoring

Vocabulary for the human-facing tools that design Zones (the `zone edit` TUI).
Distinct from the game-world language above — these are authoring concepts.

**Zone editor**:
The interactive TUI (`zone edit <id>`) for authoring a Zone — painting Terrain
and placing entities over the raw `.zone` document, rendered through the same
renderer the game uses. Operates on the lossless document, never a parsed Zone.
_Avoid_: Level editor, map editor, painter

**Placeable**:
A thing the Zone editor can place into a Zone: a Terrain type (solid), a catalog
entity (a Monster or NPC, by catalog id), or a Structure (Portal; later Spawn /
Respawn markers). The author works in Placeables, not glyphs — the editor owns
the glyph↔Placeable mapping in the header, so undeclared/orphan glyphs are
unrepresentable, not merely validated.
_Avoid_: Glyph, stamp, tile, entity (when you mean the editor-facing thing)

**Palette**:
The set of Placeables the editor offers, generated from `catalogs.json` plus the
structural primitives — never a hand-maintained list. Grouped Terrain / Monsters
/ NPCs / Structures. The editor consumes the catalog; it never edits it (a
separate creature/NPC-authoring tool will own that later).
_Avoid_: Toolbar, inventory, brushes

**Tool**:
The interaction verb bound to the pointer/cursor in the modal editor — what a
click or drag *does*. The active Tool plus the active Palette selection together
determine each edit.
_Avoid_: Mode, brush (reserve "brush" for the specific paint Tool)
