# Terminal Side-Scroller MMO

A persistent **PvE side-scrolling MMORPG** played entirely inside a terminal (TUI).
One shared, persistent World whose social hubs (**Towns**) and ambient combat zones
(**Fields**) are common to all Players; progression happens in **instanced Dungeons**
entered solo or with a friend. Players control customizable avatars, fight Monsters for
XP / levels / loot, and gather in social town hubs. Real-time combat is a first-class pillar. PvP and faction-war are
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
Customizable via: a chosen **Form**, a color/hue, one cosmetic accessory slot (e.g.
hat; cosmetic-only, separate from gear stats), and the **Nameplate** colour (whose
text is the Player's **Handle**, not a separate name).
_Avoid_: Character, hero

**Form**:
The cosmetic appearance identity a Player picks for their Avatar — a variation within
the shared humanoid body plan (build, silhouette, physical quirks); players are always
humanoid, never a different creature. Purely visual: a Form changes only the **Body
sprite**, never the logical collision box, stats, or combat numbers, so every Avatar
plays identically whatever its Form (ADR 0020). Forms live in a registry selected by a
`cosmetics.form` id, alongside hue/hat/nameplate. Not a gameplay class.
_Avoid_: Race, species, class, skin (a Form is the body, not a recolor)

**Sprite**:
The visual ASCII-art representation of an entity (Avatar, Monster, NPC). Purely
decorative and client-side; deliberately decoupled from the entity's small
logical collision/hitbox footprint (see ADR on visual architecture). A single,
static frame; the animated, multi-frame body is a **Body sprite**.
_Avoid_: Art, model, skin

**Body sprite**:
The animated ASCII-art of an entity's body — a named set of whole-frame **Pose**s
(`idle`, `walkA`/`walkB`, `jump`, the emote frames, …), the body's analogue of the
**Weapon sprite** (ADR 0020). Each Avatar **Form** is one Body sprite; the type is
entity-agnostic, so Monsters become a consumer when they animate later. A pose is a
*whole frame*, not a composited skeleton — at terminal fidelity a limb is a cell or
two, so animating is redrawing the grid. Every Body sprite must author the core
`idle`, `walkA`, `walkB`; any missing pose falls back to `idle`.
_Avoid_: Body model, rig, skeleton (poses are whole frames, there is no rig)

**Pose**:
One selectable whole frame of a **Body sprite** (or **Weapon sprite**), chosen each
render by a pure, shared function of replicated state so owner and observers agree.
Body-pose priority is a fixed ladder — `hurt/stagger > combat > airborne > walk >
emote > idle` — where, deliberately, walking cancels an **Emote**.
_Avoid_: Frame (reserve for an individual grid), stance, animation state

**Walk cycle**:
The `walkA↔walkB` alternation that animates a moving Avatar, flipped every stride of
**accumulated horizontal distance travelled** (not a clock), so it costs no wire data,
quickens with speed, and stays identical for owner and observers (ADR 0020). Freezes
when idle or airborne.
_Avoid_: Walk animation, gait timer (it is distance-driven, not timed)

**World**:
The single, persistent, shared space that all Players inhabit. There is one
*logical* World, **funnelled, not channelled** (ADR 0024): each Zone runs exactly
one shared instance, so whoever is online is guaranteed to share one set of
Towns/Fields — the soft-cap Channel split of ADR 0001 is removed. The only
instancing left is the Dungeon (entered solo or with a friend). The World is
partitioned into Zones.
_Avoid_: Server, realm, map (reserve "map" for nothing — it's too overloaded),
Channel (the parallel-instance split, removed for the demo)

**Zone**:
A discrete, bounded area of the World — a side-scrolling locale that may span
several screens (a camera follows the Avatar). An Avatar occupies one Zone at a
time and moves between Zones via connections (portals/edges). The unit of "place"
AND the unit of server simulation (each Zone runs its own tick; Zones are
independent, enabling later distribution across processes). It is also the unit of
*interest*: a Player only receives real-time updates about entities in their own
Zone. Three kinds (`ZoneType`): **Town** and **Field** each run one shared
simulation (the funnel); the **Dungeon** is the *instanced* kind — it has no shared
simulation, only a private **Instance** spun up per entry.
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

**Town**:
A safe social Zone with no monsters — where Players gather, show off avatars,
trade, and regroup. The "hub."
_Avoid_: City, hub, lobby

**Field**:
A shared, persistent combat Zone populated by Monsters — the **open-world exploration
space** and the *progression spine*. Fields radiate outward from a Town with **difficulty
gated by distance**: the further from the hub, the stronger the Monsters, so a Player's
level naturally gates how deep they can venture. This is where a Player *spends* power
(venturing further is the reward), as distinct from the **Dungeon**, where they *gain* it.
Fields still drop some XP/loot, so fighting out there is never pointless — they are just
not the *efficient* path. Funnelled, not channelled, for the demo (one shared set of
Fields, no parallel Channels).
_Avoid_: Hunting map, dungeon, level

**Dungeon**:
An **instanced**, repeatable, fixed-difficulty combat Zone entered from a Town — run
**solo or with a friend**, never shared with strangers — that is the **reliable engine
of progression**: the efficient, dependable XP/loot faucet a Player runs to level up so
they can survive deeper **Fields**. Deliberately plain: **no difficulty tiers, no
procedural generation, no matchmaking or instance-lifecycle machinery, and no Boss**
(the climax lives at the edge of the field-world). The demo ships **one** handcrafted
Dungeon. Where the Field is the *space* you spend power, the Dungeon is the *lever* you
pull to gain it. It is a **Zone kind** (a place you author, `type: "dungeon"`),
distinct from an **Instance** (the live private simulation of it) — the Dungeon is
authored once; each entry spins up its own Instance.
_Avoid_: Instance (that's the runtime simulation of a Dungeon, not the Dungeon
itself), raid, level, stage, tier

**Instance**:
The private, live **ZoneState** the server spins up when a Player (or **Party**)
enters the **Dungeon** from **Town** (#240) — the *only* instancing left in the
funnelled World (ADR 0024). Keyed by the entering Party (`<zoneId>#<leader>`): a Party
shares one Instance, so a friend co-locates, while every stranger keys their own — two
unrelated Players entering the same Dungeon get *separate* Instances and never see each
other. Created on entry, **torn down the moment its last occupant leaves** (a Portal out
or a forgiving death), so a re-entered Dungeon is always a fresh run. Shared **Town** and
**Field** Zones have no Instances — each is one funnelled simulation. Lives in
`ServerWorld.instances`, addressed by `instanceOf[sessionId]`; contrast the shared
`ServerWorld.zones`.
_Avoid_: Channel (the removed parallel-World split), instance in the Dungeon-the-place
sense, session, shard

**Party**:
A small group of Players who run a **Dungeon** together — the minimal "with a friend"
seam (#240). Each session has a party leader (itself when solo); joining another's Party
means sharing that leader's key, so the group co-locates in one **Instance**. Kept
deliberately thin for the demo: it exists to route co-op Dungeon entry (never to share a
**Field**/**Town**, which are already common to all), not as a full social system with
invites, chat scoping, or shared loot.
_Avoid_: Group, raid, guild, team, Faction (that is the PvE damage filter)

**Boss**:
The single authored, telegraphing **Monster** that gates the **deepest Field** at the
edge of the explorable world — the combat showcase's payoff and the demo's **terminal
state**: defeating it *is* "you have completed the demo." It lives in the open
field-world (not the Dungeon), so that venturing deeper pays off climactically in the
same space the Player has been exploring.
_Avoid_: Raid boss, elite, miniboss, dungeon boss

**Identity Key**:
The ed25519 public key that identifies an account (ADR 0004). Normally the
Player's own external SSH key (via ssh-agent or `~/.ssh/id_ed25519`); when they
have none, a game-generated key minted on first launch and kept in the config dir
so the demo is playable without any SSH setup. A per-machine **anchor** records
which key won last, so a returning Player always resolves to the same one — a
momentarily-unreachable external key is refused with guidance, never silently
replaced (which would orphan the Save).
_Avoid_: SSH key (it may be generated), guest key, throwaway key

**Handle**:
The durable, unique username a Player **types and claims at Avatar creation**, bound
to their **Identity Key** (ADR 0004, #235 — revising the ephemeral per-connection
label of ADR 0006). It **is** the text on the Player's **Nameplate** and the
attribution on each Chat message; set **once** at creation and durable — a returning
key always resolves to the same Handle.
Unique case-insensitively (2–16 of `[A-Za-z0-9_-]`), so `/w <handle>` is
unambiguous — but entities are still *addressed* by session id at runtime: the
Handle names the account, not the connection.
_Avoid_: Username, nick, name, label

**Nameplate**:
The floating label showing an **Avatar**'s **Handle**, tinted by a chosen palette
colour — rendered *below* the Avatar's feet (deliberately, not over the head, to keep
the headroom clear for the **Speech bubble**; ADR 0023). Its text is *always* the
Handle, never a separate string; the only customizable part is the **colour** (a
palette index).
_Avoid_: Name tag, label, tag, title (the text is the Handle, not a free label)

**Save**:
The durable per-account snapshot persisted across sessions (#236, bun:sqlite),
keyed by the account's **Identity Key** (ADR 0004). It holds *only* progression and
identity state: the Avatar's level / XP / **Gold**, its inventory + equipped
**Item**, its **Cosmetics** (**Form** / hue / hat / nameplate), the last safe
**Town**, and a **boss-defeated flag** (the demo's terminal state — see **Boss**;
plumbing today, the trigger lands with the Boss epic). Deliberately excludes
**Monster**s, transient **Zone** state, and exact position — login restores a Save
and returns the Avatar to its last Town, never its logged-off spot. Written on
significant events + a periodic flush, never per-tick, behind a pure store seam so
the simulation stays IO-free.
_Avoid_: Snapshot (that's the per-tick wire frame), checkpoint, profile, savegame

**Chat**:
Real-time text communication between Players. The first form is **Zone chat**: a
message is relayed to every session in the sender's Zone and shown
in each recipient's chat log, attributed to the sender's Handle. (Whisper comes
later; **Emote** is a separate, body-animation mechanism.)
_Avoid_: Say, talk, message

**Speech bubble**:
The ephemeral, bordered text that floats above a chatting Avatar's head, showing
their latest Chat message to everyone who can see that Avatar. A purely
client-side, decorative rendering of a Chat message (like a Sprite): it attaches
to the Avatar by session id, tracks the Avatar as it moves, and expires on a
timer — the chat log stays the durable record.
_Avoid_: Chat bubble, balloon, callout, tooltip

**Emote**:
A pose the Avatar's own body performs to express itself (e.g. `wave`, `dance`,
`sit`) — a **Pose** played on the **Body sprite**, triggered by the `/em`/`/emote`
chat command (ADR 0020). Each emote has a **lifetime mode**: `oneshot` (plays once,
then returns to idle), `loop` (cycles until interrupted), or `hold` (one sustained
pose). The active emote is replicated in the per-entity action-state, so a late
arrival still sees a held or looping emote; movement or combat clears it. *Not* the
retired overhead face-glyph popup, which it replaced.
_Avoid_: Emoji, reaction, gesture (one word — an emote is a body pose, not a popup icon)

**CombatEvent**:
The resolved, *semantic* fact of a combat interaction — "target T was **hit** /
**broke** (poise) / **died** / **swatted**, at (x,y), facing →, intensity
N." It is what Combat resolution produces; a **VisualEffect** is its client-side
presentation projection (via the `present` routing layer), and a **Particle** is that VisualEffect's
realization. The authority *produces* a CombatEvent by applying damage/poise (the poise
result is what makes a contact a hit vs a break vs a death); the local Player *predicts*
only the optimistic `hit` event from its own outgoing swing, for zero-latency feedback.
`break`/`death`/`swat` are authority-only, and so is *incoming* hurt — an
Avatar-target `hit` is never predicted (ADR 0013 §3). The kinds map `hit → blood`,
`break → impact` (heavier), `death → gore` (tinted), `swat → impact` (a light clink — a
melee frame shattering a shot, ADR 0017 §8 — at the shot's own damage, no poise bump).
It **is** the wire payload (ADR 0029, superseding ADR 0019 §B): the server broadcasts
CombatEvents and each client runs the `present` routing layer locally to project them to
VisualEffects/SoundEffects — no site emits presentation inline, and the server holds no
presentation knowledge. The originator is suppressed from its own broadcast (it already
predicted its `hit`). Modeled as a discriminated union on `kind`, so each kind carries
only the fields it can mean — `source` on a predicted `hit`, `tint` (the dead body's
colour) on a `death`.
_Avoid_: Effect (retired — see VisualEffect), HitEvent, Outcome

**VisualEffect**:
The client-side *visual* realization of a **CombatEvent** (later: other event kinds) —
e.g. "a blood-hit at (x,y), facing →, intensity N." Produced by the client-side
`present` routing layer (ADR 0013 amendment — the one stateless place projection and
realization meet) the moment a CombatEvent arrives from the wire *or* is predicted
locally; it is **not** authoritative and **never on the wire** (ADR 0029 — the shared,
authoritative thing is the CombatEvent). One VisualEffect realizes into **Particle**s
(a named effect through the particle engine's spawn door), and the same routing decides
when a moment also carries a **Camera-kick** and **Hitstop**; its audio twin is the
**SoundEffect**. The visual half of presentation, owned entirely by the client — the
server has no concept of it. Replaces the retired on-wire **Effect** (ADR 0013/0019, now
0029).
_Avoid_: Effect (retired — collided with the effect-ts library and with combat
internals; the on-wire descriptor is now the CombatEvent), FX, animation, particle
(that's the realization)

**Particle**:
A single client-side visual speck — one cell with a sub-cell position,
velocity, and lifetime — simulated locally at render framerate. A client turns
one VisualEffect into many Particles using local randomness, so the exact specks
differ harmlessly between clients; only the CombatEvent (and thus the VisualEffect it
projects to) is shared. Each Particle's motion and look (gravity, bounce, whether it
rests, glyphs, color-over-life) come from its named effect's **ParticleType** profile,
not from hardcoded blood behavior. Purely decorative and client-side, like a Sprite.
_Avoid_: VisualEffect (that's the descriptor a Particle realizes), sprite, pixel (ambiguous), FX

**ParticleType**:
The visual profile a Particle belongs to (`blood`, `gore`, `impact`, `levelup`, later
`dust`, `sparkle`…) — a declarative data entry defining its whole behavior: gravity,
bounce, terrain collision, rest and fade durations, glyph sets, color-over-life,
count-from-intensity. One generic client simulator reads the profile, so a new look is
a new definition file, not new code — and since the ADR 0013 amendment the profile is
**engine-internal**: the particle engine's only public surface is the *named effect*
(`spawn('blood', at, dir, intensity)`); no caller can construct or pass a raw profile.
Distinct from a **CombatEvent**'s `kind`: that is the *semantic game event* (`hit`),
mapped client-side (via a **VisualEffect**) to a named effect.
_Avoid_: CombatEvent.kind, ParticleKind, sprite

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
**VisualEffect** (from a break CombatEvent), so it fires for everyone who sees the
break, attacker included.
_Avoid_: screenshake, rumble, camera shake (it's a single decaying pop)

**SoundEffect**:
The client-side *audible* realization of a moment — the audio twin of a Particle.
Where a Particle answers *what it looks like*, a SoundEffect answers *what it
sounds like*. Two sources feed it: an authoritative **CombatEvent** (so a
nearby Avatar's hit or death is heard, spatialized by position — realized by the same
client `present` routing that produces VisualEffects) and a purely local interaction (your
own jump, a menu blip — never on the wire). Always
best-effort and non-authoritative: if there is no audio device, every SoundEffect
is a silent no-op and the World behaves identically. The shared sim never
references one — like a Sprite or Particle, it is the client's business alone.
_Avoid_: Cue, sound, audio (reserve for the engine/files), CombatEvent (that's the
authoritative trigger, not the audible result), VisualEffect (that's its visual twin), FX

**Monster**:
A hostile, server-controlled entity that Players fight for XP and loot. Lives in
Fields.
_Avoid_: Mob, enemy, NPC, creature

**NPC**:
A non-hostile, server-controlled character (shopkeeper, quest-giver, etc.).
Distinct from Monster — NPCs are never fought.
_Avoid_: Vendor, bot

**Brain**:
The decision function that controls a **Monster** each tick: it perceives a
limited view of its Zone and produces a **Drive** — including whether to commit
an attack — and nothing else. A Brain never applies damage, never moves
anything, and never touches another entity; every consequence it initiates
flows through the same **Strike** resolution as a Player's. Each Monster
archetype (chaser, **Brute**, **Ranged poker**, the **Boss**) is one Brain, and
a Brain may keep private memory that the rest of the simulation — and the wire
— never sees.
_Avoid_: AI (too generic), behavior script, controller (reserve for the
Player-side input path)

**Melee committer**:
A Monster archetype that deals damage *only* through a telegraphed melee **Attack
phase** — approach/space → **wind-up** (committed, replicated for the Player to
read) → **active** (the one damaging window) → **recovery** (a punishable opening,
it cannot re-commit or cancel). The reworked chaser is the first one. Monsters have
**no passive contact damage**: overlapping a Monster does nothing, so every point of
incoming damage was dodgeable/punishable. See ADR 0017 §9.
_Avoid_: Melee mob, contact damage, walk-into-you damage

**Brute**:
The heavy **Melee committer** authored for the deep Field (Field 3) — a slow,
high-**Poise**, hard-hitting bruiser (ADR 0024 §8). Deals damage **only** through the
same telegraphed **wind-up** → **active** → **recovery** swing as the chaser (no passive
contact damage), but its whole profile is the chaser's opposite: it lumbers at half the
chaser's speed, carries a much larger Poise pool and heavy **Mass** (so it shrugs off a
flurry and barely flinches from **Knockback**), hits far harder, and attacks
*deliberately* — a long cool-down between commits leaves a wide, punishable opening
between heavy blows. Read it and punish the recovery; don't trade with it.
_Avoid_: Tank, Golem (that is only its player-facing Sprite/name), heavy mob, boss
(the Boss is its own single authored Monster)

**Ranged poker**:
A Monster archetype that fights at distance — the reworked shooter. Like the **melee
committer** it deals damage *only* through a telegraphed **Attack phase**: it
maintains distance, and on a commit runs the same **wind-up** → **active** →
**recovery** swing, **firing exactly one Projectile on the active frame** (never
auto-firing). The wind-up is the Player's cue to **Dodge**/**Block**/**swat** the
shot or close in to punish the recovery. See ADR 0017 §8.
_Avoid_: Archer, turret, auto-shooter, hitscan mob

**Projectile**:
A **first-class hit that travels** — not a special-case ranged poke. It carries the
*same* hit-reaction payload a melee swing does (**HP damage** + **poise damage** +
**Knockback**), so a heavy shot **Staggers** on a **Poise** break exactly like a
melee connect while a pebble only chips, and it resolves through the same hit path.
It travels at a **reactable** speed (not hitscan). Every shot is hostile and countered
by the defensive kit: **Dodge** through it (i-frames), **Block** it (chip + poise
drain), or **swat** it with a melee active frame (**Parry**/**Reflect** removed, ADR
0024). As a travelling attack it emits a **Strike** into the *resolve* pass, the same
handoff a melee swing uses. See ADR 0017 §8, ADR 0022, ADR 0024.
_Avoid_: Bullet, missile, hitscan

**swat**:
Destroying a hostile **Projectile** with a melee active frame — a Player's live swing
or skill hitbox overlapping the shot shatters it (a light clink, no **Poise** break).
The shot is simply gone; nothing is reflected back. The kept ranged counter alongside
**Dodge** and **Block** (**Parry**/**Reflect** removed, ADR 0024). See ADR 0017 §8.
_Avoid_: Deflect, parry, reflect, bounce

**Combat**:
Real-time PvE (Player vs Monster) fighting — a first-class pillar, not flavor.
Built on **commitment**: an attack is not instant but occupies time in **phases**,
so *when* you commit is itself a skill. **Positional / directional hitbox** model;
melee aim is **contextual and forgiving** (a wide frontal arc, plus a vertical
**Launcher**/**Spike**), ranged is **precise** (directional projectiles; mouse-aimed
for ranged Classes later). Skill expression lives in timing (**Dodge**, reading
telegraphs) and **Knockback**-driven **Juggles**, all regulated by **Poise**. Clients send
*intents* and predict their own actions; the server resolves every outcome
authoritatively (hit, damage, kills, loot). The combat slice of an Intent
(attack/skill) is gated by a single shared resolver (`resolveCombat`) that both
the authoritative server step and the client's optimistic telegraph run, so they
can never gate a swing or skill differently. The tick itself is **project-then-
resolve** (ADR 0022): per-entity passes advance state and emit **Strike**s, and one
resolve pass lands every Strike by the **Faction**-gated uniform rule. See ADR 0017,
ADR 0022.
_Avoid_: Fighting, battle, PvE, tab-target (use "Combat")

**Strike**:
A **projected attack** handed from a per-entity *project* pass to the *resolve* pass
of the combat tick (ADR 0022) — _"this hitbox deals this HP + **Poise** damage, facing
→, on behalf of this **Faction**."_ It is a projection,
never applied where it is made: an Avatar swing, a **Melee committer**'s strike, and a
travelling **Projectile** all emit Strikes, and `resolveCombat` resolves every one by a
single rule — against overlapping, **hittable**, opposing-**Faction**, not-already-hit
victims. The per-swing dedup ledger (`swingHits`, ADR 0017 §2) is *not* part of a
Strike; it lives on the attacking entity (a multi-contact attack instance), so a
single-contact Projectile carries none.
_Avoid_: Hit (reserve for the resolved contact), Attack, Hitbox (a Strike is more)

**Faction**:
The allegiance key — `players` | `monsters` — that decides which entities a **Strike**
may resolve against: opposing-Faction only. It makes **PvE** hold *by construction*
rather than by scattered checks: two **Avatar**s share a Faction, so no Avatar ever
damages an Avatar — PvP stays parked. See ADR 0022.
_Avoid_: Team, side, alliance, allegiance (in the PvP/guild sense — Faction is the
PvE damage filter, not a social group)

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

**Stamina** _(stretch goal — not in the frozen demo; see ADR 0024 amendment)_:
A souls-model **action budget** consumed by **attacking, dodging, and Active skills**,
regenerating automatically when unspent — run dry and those actions lock until it refills,
so *when* you act becomes a resource decision. Deliberately distinct from **Poise**: Poise
is passive *resistance to being staggered*, Stamina is your active *budget to act*; the two
never overlap, and **Block** stays on the Poise/guard-break system (it costs no Stamina).
Absent from the codebase today; to be scoped and planned separately before any build.
_Avoid_: Energy, mana, endurance, poise (that is the stagger resource, not the action budget)

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
light Slime across the screen but barely lifts a heavy Golem.
_Avoid_: Weight, heaviness

**Momentum body**:
The single physics body every entity — Avatar and Monster alike — integrates each
tick (`position + velocity + Mass`): input drive + external impulses + gravity −
drag, then the shared axis-separated Terrain collision. **Knockback** is just an
impulse fed into it, so a shove decays under drag and a launch arcs under gravity
on the same path that walks and jumps. Monsters are airborne-capable on it with no
special case (`stepEntity` in `physics.ts`).
_Avoid_: Rigidbody, actor, character controller

**Drive**:
The per-tick movement decision an entity's controller feeds into the physics
step — move direction, jump, and optionally an attack commit. Produced from the
Player's **Intent** for an Avatar and by a **Brain** for a Monster; the
simulation consumes Drives without knowing or caring who is driving. The seam
that makes Avatars and Monsters move through one shared path.
_Avoid_: Input (raw client keys), Intent (the client→server bundle a Drive is
derived from), command, controls

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
The unified, frontal-arc defensive stance. Any raised Guard is a **Block** (Parry
removed, ADR 0024). Hits from behind ignore it.
_Avoid_: Defend, stance, shield

**Block**:
Holding **Guard** to absorb a frontal hit for chip damage, draining **Poise** toward
a guard-break. The safe defense; the only Guard behaviour (Parry removed, ADR 0024).
_Avoid_: Shield, brace

**Guard-break**:
The **Stagger** a **Block** suffers when sustained chip drains its **Poise** pool to a
break — turtling punished by the same accumulating-Poise system as any other break, not
a separate guard meter.
_Avoid_: Shield-break, stun

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
extensions, the **Launcher**, aerials, the **Spike**, cancels —
unlocked by level (and later **Class**). Distinct from an **Active skill**; it is
*how your character moves*, not a thing you fire.
_Avoid_: Skill (reserve for active), passive, combo move

**Active skill**:
A slotted, cooldown-bound special move (e.g. Power Strike, Ground Pound) fired on
its own input. Distinct from a passive **Moveset ability**.
_Avoid_: Ability, spell, move

**Weapon stat block**:
The data an equipped Weapon **Item** contributes (ADR 0024): **damage**, its
rolled **Affixes**, and its visuals — the **Weapon sprite** and that sprite's
**Weapon accent** colour. Nothing else: every weapon swings the one
sword-and-shield **Moveset** with the one shared animation set (phase durations,
arc/reach, **Poise** damage, and **Knockback** are shared COMBAT constants), so a
weapon can never change playstyle — loot variety is stats and looks. The weapon's
catalog id joins the Avatar's replicated appearance, so others see your weapon.
_Avoid_: Weapon type, weapon class (reserve **Class** for the Avatar archetype);
per-weapon feel / phase-speed / arc (removed with the demo scope freeze)

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
The single per-**Weapon** colour that drives its blade highlight and **Blade-edge
arc**, so a weapon reads as a distinct object even at rest (ADR 0018). The
rarity-ready seam: when loot rolls rarity tiers, the tier colour feeds this same
channel with no rework. The weapon's structural palette (grip, guard) is authored
separately on the sprite; the accent is the one dynamic channel.
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

**Drop**:
An **Item** left resting in the world where a **Monster** died, rather than teleported
straight into the bag (#238, ADR 0024 §2). It is **collected on touch** — walk your
**Avatar** over it and it enters your inventory — and it **fades** after a while if left
uncollected (grab it before it vanishes). A Drop is **private**: because loot is
**instanced**, only its owner ever sees or can pick it up, so the server streams each
Player only its own Drops. Rendered in the world as a **rarity-coloured** glyph with a
floating rarity+name label, so a tier reads at a glance both where it lies and as you grab
it. Shared XP still lands immediately on the kill; only the Item becomes a Drop.
_Avoid_: Loot pile, drop table (that is the Loot table), pickup item (it is an Item)

**Loot table**:
The per-**Field**/**Dungeon** drop rules (#238, ADR 0024 §2/§3), keyed by **Zone id**:
which **base** types that Zone can drop, the **drop chance** that gates whether a kill
drops at all (the "when" lever — the **Dungeon** is the reliable faucet at 100%, **Fields**
drop only occasionally so hunting out there is a bonus, not the efficient path), and an
optional rarity re-weighting (deeper Zones tilt toward higher tiers). Pure data over the
shared, seeded roll logic (bases / rarity weights / affixes / `rollItem`); an unauthored
Zone falls back to the default full-pool table.
_Avoid_: Drop table (ambiguous), spawn table, loot list

**Gold**:
The single currency. Drops from Monsters; earned by selling Items to NPC vendors.
Spent on Trade, the Auction House, and NPC purchases.
_Avoid_: Coins, money, currency, credits

**Trade**:
A direct, face-to-face, both-sides-confirm Item/Gold swap between two Players in a
Town. Server-authoritative and atomic.
_Avoid_: Swap, exchange, deal

**Server-authoritative economy**:
Every Gold-and-Item transaction (selling loot to a **Merchant**, and later **Trade** /
**Auction House** / NPC purchases) is resolved on the server and never trusted from the
client (#267, ADR 0025). A client sends only an *intent* — e.g. "sell item #7" — and the
server re-derives the price (`saleValue`), verifies the Item is in that Player's own
inventory, and gates the transaction on the Player standing at the relevant NPC; an
unowned/unknown id or a request from afar is a silent no-op. The whole rule lives in a
pure `@mmo/core` function so the (removed) offline loop and the live server can't
diverge, and the authoritative Gold/inventory ride the **snapshot** back — the client
never mutates its own balance optimistically. Successful transactions are durable
(persisted as a significant event).
_Avoid_: Client-side shop, optimistic economy, trusting the client price

**Merchant**:
The Town **NPC** a Player interacts with (walk over, press interact) to open the
shop overlay and **sell** loot for **Gold** (buying starter goods is a later slice).
Reads the Player's Gold + inventory from the **snapshot** and issues `sell` intents;
the server owns the outcome (see Server-authoritative economy).
_Avoid_: Shopkeeper (when you mean the mechanic), store, vendor UI

**Auction House**:
A global asynchronous market where Players list Items for Gold; the server escrows
listed Items and Gold. Coexists with Trade. Post-MVP. Bots/RMT are explicitly a
non-concern (open-source, for-fun).
_Avoid_: Market, AH, marketplace, exchange

**Instanced loot**:
When multiple Players damage a Monster, every contributor earns XP and rolls their
*own* private Item **Drop**s — there is no shared loot pile. Each contributor's Drop is
seeded off its own RNG (so loot never crosses between Players) and rests in the world for
that Player alone to collect on touch. Eliminates kill-stealing and makes other hunters in
a Field feel like help, not competition. (Player death is forgiving: respawn in Town, no
XP or Item loss at MVP.)
_Avoid_: Loot share, drop table (per-player), kill credit

**Terrain**:
The solid geometry of the world (platforms, walls, ground, ropes/ladders) — the
only thing Avatars physically collide with. Avatars do NOT collide with each
other; they pass through one another freely. Movement is a real-time platformer
(gravity + jumping). Two solid tile kinds: **Wall** and **One-way platform**.
_Avoid_: Tiles, level, collision map

**Wall**:
A fully solid Terrain tile — glyph `#`, cell value `1`. Blocks every side: you land
on its top, and it stops horizontal motion beside it. The world bounds read as walls
too, so an Avatar can never leave its Zone sideways. Ground and vertical posts are
walls.
_Avoid_: Solid, block

**One-way platform**:
A Terrain tile you can stand on but also pass through — glyph `=`, cell value `2`
(ADR 0026). Vertically it behaves like any solid: a descending body lands on its top
surface, a rising body passes through it (the global one-way rule, #262).
Horizontally it is **transparent** — unlike a Wall it never halts sideways motion, so
jumping up through a platform while moving left/right feels smooth. Authored per tile,
distinct from a Wall so a structure can mix posts (walls) and ledges (platforms).
_Avoid_: Ledge, floor, semisolid

**Sweep**:
The physics module's terrain-collision primitive: what does a point travelling
from A to B hit? Bidirectional and axis-separated (x leg, then y leg), it checks
every cell crossed so fast travel cannot tunnel, and it carries the global
one-way rule — a One-way platform stops only descending travel; a Wall blocks
point travel in every direction. The ascending leg exists for point travellers:
rising Particle specks used to embed inside thick solids (ADR 0013 amendment).
Rising *bodies* still pass any solid vertically — the **Momentum body** step
keeps ADR 0026's no-head-bonk by never sweeping upward. Both integrators (the
Momentum-body step and the projectile step) resolve terrain through it, and the
client **Particle** simulation rebuilds on it, so "what blocks a moving point"
has exactly one answer (ADR 0032).
_Avoid_: Raycast, trace, sweep test (physics-engine jargon; this is cell-grid
point travel)

**Interact edge**:
The `interact` intent as a one-shot **edge**, not a held flag (ADR 0027): a single
physical press of the interact key yields exactly one true reading, used to enter a
**Portal** or open a **Merchant**. Latched on the client until the next network send
(so a fast render poll can't lose it) and consumed once per server tick via a
pending-edge queue (so it can't re-fire) — the reason a press enters a Portal exactly
once even though the arrival can overlap the return Portal (#90).
_Avoid_: Interact flag, use key, action button

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

## Sprite authoring

Vocabulary for authoring sprite art (the `sprite edit` TUI and the `.sprite`
asset file). Like Zone authoring, these are authoring concepts, distinct from
the game-world language above.

**Sprite file**:
The `.sprite` asset file that *is* a sprite's source of truth — human-readable
art (glyph grids you can see in a text editor, zone-style) plus its metadata:
named Pose frames, **Anchor**s, colors, per-pose animation speed. One format
covers every sprite shape (a hat is the degenerate single-frame case; a Form and
a Weapon are richer profiles of the same format). Identity is the filename
(cf. Zone id), and the containing directory names its **Sprite role**. Consumed
at runtime — the file, not code, is where art lives.
_Avoid_: Asset (too generic), art file, sprite sheet (there is no atlas)

**Sprite role**:
What a Sprite file is *for* — form, hat, weapon, monster — named by the
directory it lives in, and driving which validation profile applies (a form must
author `idle`/`walkA`/`walkB` and `grip`/`head`; a weapon its phase frames and
grip). Cosmetic roles (form, hat) are registered by scan — the file existing is
what makes it pickable; combat-entity roles (weapon, monster) are the *art half*
of a catalog entry that references the Sprite file by id.
_Avoid_: Type, kind, category

**Sprite editor**:
The interactive forge TUI (`sprite edit`) for drawing sprite art in **Pixel**s —
the author paints sub-cell pixel art and the editor compiles it to half-block
glyph grids, so nobody hand-XORs quadrant glyphs. WYSIWYG against the shared
renderer: mirrored facing, animation playback, and the **Composited preview**
are part of drawing, not a separate check. An **inexpressible cell** (more
colors than a terminal cell can carry) is blocked at paint time — unrepresentable,
not merely validated (cf. Placeable).
_Avoid_: Paint program, pixel editor (it edits Sprite files, pixels are the means)

**Pixel**:
The Sprite editor's atomic unit — one quadrant sub-cell, four per terminal cell
(2×2), each either a color or transparent. What the artist paints; the glyph is
derived. A cell carries at most two colors (fg + bg), which is the medium's
grain, not an editor limit.
_Avoid_: Cell (that's the 2×2 group), dot, subpixel

**Glyph stamp**:
The secondary Sprite-editor Tool that places one arbitrary character into a cell
(`▲`, `╱`, `·`) for art the pixel model cannot express. A stamped cell is
glyph-authored and immune to pixel painting until cleared.
_Avoid_: Text tool, character brush

**Anchor**:
A named cell a Sprite file declares for attaching overlays — `grip` hangs the
Weapon sprite, `head` seats the hat; names are open, so new overlay kinds are
new names, not a format change. Declared per file with optional per-frame
overrides (a Pose that raises the arm carries the weapon with it). Mirrors with
facing. Generalizes the **Grip anchor**.
An anchor is an **offset**, not an in-bounds cell reference: any integer is
valid, including negatives, so a weapon grip legitimately sits one cell left of
its art (`grip: [-1, 2]` on the sword). A value outside the art bounds (either
direction) is a *warning* only — a typo guard that grip-style anchors on weapons
legitimately trip — never a rejection (ADR 0031).
_Avoid_: Mount point, slot, hardpoint

**Composited preview**:
The Sprite editor's in-context render: the work-in-progress sprite shown as the
game will actually draw it — a hat seated on a body, a weapon in the hand across
its swing, a Form wearing hat and weapon — against the game's real background,
through the shared renderer. The forge analogue of the Zone editor's "faithful
render" promise.
_Avoid_: Mannequin, dress-up view, test render
