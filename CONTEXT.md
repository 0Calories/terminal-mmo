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

**Effect**:
A small, authoritative descriptor of a momentary world event worth showing —
e.g. "a blood-hit landed at (x,y), facing →, intensity N." Produced
deterministically in shared logic the moment Combat resolves, and broadcast to
every session in the Zone (like an Emote) *except* the session that caused it
(which predicts it locally). An Effect says *what happened*, never *what it
looks like* — its visual realization is the client's business (see Particle).
The local Player predicts their own Effects client-side for zero-latency
feedback; the server derives the same Effects independently and authoritatively.
_Avoid_: Event (too generic), FX, animation, particle (that's the realization)

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

**Monster**:
A hostile, server-controlled entity that Players fight for XP and loot. Lives in
Fields.
_Avoid_: Mob, enemy, NPC, creature

**NPC**:
A non-hostile, server-controlled character (shopkeeper, quest-giver, etc.).
Distinct from Monster — NPCs are never fought.
_Avoid_: Vendor, bot

**Combat**:
Real-time PvE (Player vs Monster) fighting — a first-class pillar, not flavor.
**Positional / directional hitbox** model with **8-directional, keyboard-driven
aim** (no target-lock): you hit what you're aimed at and near. **Melee is
forgiving** (a wide frontal arc — rewards getting in close, not precise aim);
**ranged is precise** (directional projectiles — rewards aim). Clients send
*intents*; the server resolves all outcomes authoritatively (hit, damage, kills,
loot) and clients display what the server decides; the client may play an
optimistic local telegraph (swing/projectile) before the authoritative result
arrives. The combat slice of an Intent (attack/skill) is gated by a single
shared resolver (`resolveCombat`) that both the authoritative server step and
the client's optimistic telegraph run, so they can never gate a swing or skill
differently.
_Avoid_: Fighting, battle, PvE, tab-target (use "Combat")

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
