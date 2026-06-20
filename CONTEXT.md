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
arrives.
_Avoid_: Fighting, battle, PvE, tab-target (use "Combat")

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
