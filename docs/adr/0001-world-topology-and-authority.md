---
status: accepted
---

# World topology and authority model

We are building a persistent PvE side-scrolling MMORPG in the terminal, targeting
~1,000 concurrent players as a pet project (one human, optimizing for
coolness-per-effort and a demoable slice). Three interlocking architecture
decisions were made together because they only make sense as a set.

## Decisions

1. **One logical, persistent shared World.** Not a hub-plus-instanced-runs game.
   Everyone coexists in one continuous World partitioned into **Zones** (discrete,
   portal-connected, side-scrolling locales that may span several screens).

2. **Hybrid authority (client owns movement, server owns consequences).** Each
   client is authoritative over its own Avatar's position (broadcast + loose
   server sanity-check); this is safe because Avatars pass through each other, so
   position is never contested. The server is authoritative over every
   *consequence* — Monster HP, hit resolution, loot, XP, inventory, currency,
   trades. Cheating progression/economy requires breaking the server, not the
   client.

3. **Zone is the unit of interest AND simulation, with automatic channeling.** A
   Player only receives real-time updates about entities in their own Zone (and
   Channel). Each Zone runs its own independent tick loop (one process in v1;
   distributable across processes later). When a Zone exceeds a soft population
   cap, the server transparently splits it into **Channels** — server-managed
   parallel instances. Channeling policy: route on Zone *entry* (no mid-Zone
   migration except when draining a near-empty Channel); party/friend-aware
   routing; fill-before-split; consolidate on drain with hysteresis (~80% open,
   ~30% retire). The Player never chooses a Channel.

## Considered and rejected

- **Fully server-authoritative simulation** (server simulates platformer physics
  from raw inputs; clients predict + reconcile with rollback). Rejected: that's
  the expensive netcode we explicitly want to avoid, and it's overkill because
  movement is uncontested (pass-through Avatars).
- **Fully client-authoritative** (server is a dumb relay). Rejected: makes every
  outcome an unfalsifiable client claim — fatal for a progression MMO meant to be
  shown off.
- **Hub + instanced runs** (e.g. co-op dungeon instances). Rejected: not the
  "honest MMO" / one-shared-world feeling the project is aiming for. Instancing
  can be added later for specific content (e.g. raids) if ever wanted.
- **Manual, player-selected channels (MapleStory-style).** Rejected in favor of
  automatic server-managed channeling — better UX, and party-aware routing keeps
  friends together without making the Player think about it.

## Consequences

- Channeling means the "one World" promise is *logical*, not absolute: under load,
  two players in the same Zone may be in different Channels and unable to see each
  other. Accepted, and mitigated by party-aware routing + fill-before-split.
- Movement cheating (flying, teleporting) is possible and tolerated — it harms no
  one but the cheater's own immersion, since positions are uncontested.
- Rare, accepted unfairness: when two players act on shared state near-simultaneously,
  the server arbitrates and a client may see a local action (e.g. a hit) overruled.
  We deliberately do not build reconciliation to prevent this.
- Area-of-interest (sub-Zone culling) is the chosen scale-later lever for crowded
  single Channels; not built in v1.
