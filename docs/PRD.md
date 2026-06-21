# PRD — Terminal MapleStory (MVP)

> Source of truth for vocabulary: [`CONTEXT.md`](../CONTEXT.md). Architecture
> decisions: [`docs/adr/`](./adr/) (0001 world topology & authority, 0002 tech
> stack, 0003 visual architecture, 0004 SSH-key auth). This PRD scopes the MVP
> (milestones M0–M4); anything not here is post-MVP.
>
> The **Zone authoring pipeline** (data-driven Zones + `zone-tools`) is a focused
> downstream initiative with its own PRD ([#50](https://github.com/0Calories/terminal-mmo/issues/50)),
> gated by [ADR 0008 (Zones as data)](./adr/0008-data-driven-zones.md).

## Problem Statement

Developers live in the terminal but have nowhere to *play together* there. Existing
terminal games are single-player or turn-based; existing MMOs require leaving the
CLI for a heavy graphical client. There is no persistent, social, real-time game
world that is native to the place developers already are — and that treats the
terminal not as a fallback but as the point.

## Solution

A persistent **PvE side-scrolling MMORPG** played entirely in the terminal. A
Player authenticates with their SSH key, customizes an ASCII-art **Avatar**, and
enters **one shared World** of side-scrolling **Zones**. They gather in social
**Towns** (chat, whisper, emote, show off) and hunt **Monsters** in **Fields** for
XP, levels, and randomized-affix **Item** loot — in real time, alongside other
Players, with smooth motion and responsive controls. It installs and launches in
one command (`bunx`), so trying it is as frictionless as the SSH dream that
inspired it, without the input lag.

## User Stories

**Onboarding & identity**
1. As a Player, I want to launch the game with a single command (`bunx`), so that trying it costs me nothing.
2. As a Player, I want to authenticate with my existing SSH key, so that I never create or remember a password.
3. As a new Player, I want to claim a username bound to my public key on first launch, so that I have a persistent identity.
4. As a returning Player, I want my Avatar, level, gold, and inventory to be exactly as I left them, so that progress is durable.

**Avatar & customization**
5. As a Player, I want to create a Warrior Avatar, so that I can enter the World.
6. As a Player, I want an expressive multi-row ASCII-art Avatar (not a single glyph), so that my character has visual personality.
7. As a Player, I want to recolor my Avatar and pick a cosmetic hat and nameplate color, so that I'm recognizable and can express myself.
8. As a Player, I want to see other Players' customizations rendered around me, so that the World feels populated by individuals.

**Movement & presence**
9. As a Player, I want to run, jump, and fall with platformer physics, so that traversal feels like a real side-scroller.
10. As a Player, I want my own movement to feel instant (zero input lag), so that jump timing is reliable.
11. As a Player, I want to see other Avatars move smoothly in real time, so that co-presence feels alive.
12. As a Player, I want to pass through other Avatars rather than collide, so that crowds never block me.
13. As a Player, I want a camera that scrolls across a multi-screen Zone following my Avatar, so that Zones can be larger than one screen.
14. As a Player, I want to move between Zones through portals, so that the World is navigable.

**Combat & the hunt**
15. As a Player, I want to attack in 8 directions with keyboard aim, so that combat is positional and skill-expressive.
16. As a Warrior, I want a forgiving melee arc, so that getting in close — not pixel-aim — is what matters.
17. As a Player, I want my attacks to play an immediate local telegraph, so that combat feels responsive even before the server confirms.
18. As a Player, I want the server to authoritatively resolve hits, damage, and kills, so that outcomes are consistent and fair.
19. As a Player, I want to fight a melee-chaser Monster and a ranged-shooter Monster, so that positioning decisions matter.
20. As a Player, I want Monsters to spawn at fixed points and respawn on a timer, so that a Field is reliably huntable.
21. As a Player, I want to earn XP and level up (to a cap of ~30 at MVP), so that I grow stronger.
22. As a Player, I want a couple of Warrior skills to unlock as I level, so that combat deepens.
23. As a Player, I want death to be forgiving (respawn in Town, no XP or Item loss), so that the game stays fun.

**Loot & economy**
24. As a Player, I want Monsters to drop randomized-affix Items with rarity tiers, so that the chase is near-infinite.
25. As a Player, I want rarity shown as color, so that good drops are instantly legible.
26. As a Player hunting alongside others, I want my *own* private loot rolls (instanced loot), so that there is never kill-stealing.
27. As a Player, I want all contributors to a kill to earn XP, so that other hunters feel like help, not competition.
28. As a Player, I want to equip Items into Weapon/Armor/Accessory slots, so that gear drives my build.
29. As a Player, I want to sell junk to and buy starters from an NPC vendor for Gold, so that there's a Gold sink and floor.

**Social hub**
30. As a Player in a Town, I want zone-local chat, so that the hub feels alive.
31. As a Player, I want to whisper another Player by name, so that I can talk privately.
32. As a Player, I want a small set of emotes, so that I can express myself in a crowd.

**World scaling (transparent to the Player)**
33. As a Player, I never want to pick a channel manually; the server should place me, so that I don't think about infrastructure.
34. As a Player, I want to be routed to the same Channel as my party/friends when that exists (post-MVP), so that I'm with the people I came to see.

## Implementation Decisions

- **Monorepo, three packages:** `client` (OpenTUI TUI), `server` (Bun WebSocket + Zone simulation), `shared` (wire protocol, physics constants, combat/progression formulas). The shared package is imported by both sides so game logic is written once. (Per ADR 0002.)
- **Authority (ADR 0001):** client is authoritative over its own Avatar position (broadcast + loose server sanity-check, safe because Avatars are non-colliding); server is authoritative over all consequences — Monster HP, hit resolution, Item drops, XP, Gold, inventory.
- **Simulation cadence:** server ticks each Zone at ~20 Hz; clients render at 30+ fps decoupled from the tick; own Avatar rendered locally at full rate; other entities rendered ~100 ms in the past via interpolation between snapshots.
- **Interest & channeling (ADR 0001):** the Zone (+ Channel) is the unit of interest and simulation; clients only receive updates for entities in their Zone/Channel. Each Zone runs an independent tick loop. Automatic, server-managed channeling routes on Zone entry with a soft cap; for MVP a soft cap is enough (consolidation/AOI are post-MVP).
- **Visual architecture (ADR 0003):** logical entity (small ~1×2 collision/hitbox) is hard-decoupled from the decorative ~5×7 multi-row ASCII **Sprite**. Overlap is allowed; z-order by y-position with the local Avatar on top. Sprite size sets world scale. Combat telegraphs render as high-contrast glyphs above all Sprites. MVP poses: idle/walk/jump/attack × mirrored facing.
- **Combat:** positional/directional hitbox, 8-directional keyboard aim, no target-lock. Melee = forgiving frontal arc; ranged = precise projectiles. Clients send intents; server resolves on its tick.
- **Classes:** small fixed set planned (Warrior/Archer/Mage); **MVP ships Warrior only.** Stats are auto-by-class+level (no manual allocation); levels give baseline power + skill unlocks; Items give build variety and the chase.
- **Items:** base type + rarity tier + randomized affixes; rarity→color; slots Weapon/Armor/Accessory. Instanced loot: per-contributor private rolls; shared XP.
- **Auth (ADR 0004):** SSH-key challenge-response. First launch registers username↔public-key. No passwords; no browser.
- **Persistence:** `bun:sqlite`. Persist Account, Avatar (class/level/XP/Gold), inventory + equipped Items (JSON blob to start), cosmetics, last Town. Do NOT persist Monsters (transient) or Zone/terrain (static content). Write on significant events + periodic flush; never per-tick.
- **Transport:** WebSocket, binary frames.
- **Delivery:** `bunx <game>` and/or `bun build --compile` single-file binary. SSH is NOT a play/render path (ADR 0002).

## Testing Decisions

A good test asserts **external behavior**, not implementation details, and runs **deterministically**. The rendering layer is explicitly *not* unit-tested (its "behavior" is visual) — it is validated manually via the M0 spike.

- **Highest seam — the `shared` simulation as pure functions.** The platformer world-step (movement + swept collision against Terrain), combat resolution (hitbox → damage → death), instanced-loot rolling (seeded RNG), and progression (XP→level) are pure, deterministic functions. Test them by feeding inputs and asserting outputs/state — no server, no client, no sockets, no rendering. This is the primary seam and where most tests live.
- **Zone simulation seam.** Drive a Zone's tick with a scripted sequence of intents and assert resulting authoritative state (Monster spawn/aggro FSM transitions, combat outcomes, loot grants). Deterministic, no network.
- **Protocol seam.** Round-trip encode→decode of every wire message type; assert equality.
- **Auth seam.** Sign a challenge with a test keypair; assert the server verifier accepts valid signatures and rejects tampered ones.
- **Persistence seam.** Save→load an Avatar against a temp/in-memory SQLite; assert round-trip fidelity.

Test runner: `bun test` (built in). Seed all RNG so loot/spawn tests are deterministic.

## Out of Scope (MVP)

Archer & Mage classes; parties, friends list, global/world chat; the Auction House; player-to-player Trade (designed-for but not built); channel consolidation & area-of-interest culling; manual stat allocation; harsh death penalties / permadeath; crafting; multiple Towns/Fields beyond one each; PvP and faction-war; SSH transport tunnel; GitHub OAuth; account recovery / key rotation; cross-process Zone distribution.

## Further Notes

- **M0 is a go/no-go gate.** Before committing to M1+, the spike must prove OpenTUI can scroll a camera over Terrain and move many ~5×7 Sprites at 30+ fps. If it can't, the visual bet (ADR 0003) and possibly the stack (ADR 0002) get revisited.
- **Milestones:** M0 spike → M1 single-player loop (no server) → M2 multiplayer foundation → M3 identity + persistence → M4 delivery + tuning. Each is independently testable.
- Bots/RMT are a deliberate non-concern (open-source, for-fun).
