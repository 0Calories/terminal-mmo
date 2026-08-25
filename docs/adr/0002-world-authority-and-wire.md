---
status: accepted
---

# World topology, hybrid authority, and the wire protocol

## Decisions

- **One logical, persistent shared World** partitioned into portal-connected,
  side-scrolling **Zones**. Everyone coexists; the only instancing is the
  Dungeon (keyed per entering Party, torn down when its last occupant leaves).
  The World is **funnelled, not channelled**: each Town/Field runs exactly one
  shared simulation, so whoever is online shares one set of places — at a
  realistic population of 0–5 concurrent players, anti-fragmentation beats the
  original soft-cap Channel split.
- **Hybrid authority: the client owns its own Avatar's movement; the server
  owns every consequence** (Monster HP, hit resolution, loot, XP, inventory,
  Gold, trades). Safe because Avatars pass through each other — position is
  never contested — while cheating progression requires breaking the server.
  Fully server-authoritative physics (predict + reconcile + rollback) is the
  expensive netcode this project exists to avoid; fully client-authoritative
  makes every outcome an unfalsifiable claim.
- **All game logic lives in `@mmo/core` as pure, deterministic,
  framework-free functions**, so client and server run identical code and can
  never diverge. IO (sockets, disk, timers) stays at the host edges. There is
  exactly one consequence engine: the server's zone step, which the forge
  playtest drives through a synthetic local session.
- **Zone is the unit of interest and simulation**: the server ticks each Zone
  at 20 Hz and streams a per-recipient snapshot; a Player only receives
  updates about their own Zone. The client renders decoupled (60 fps default)
  and predicts its own Avatar at full local rate.
- **The wire protocol is a hand-rolled binary codec** over a `DataView` with a
  leading message-type tag and exact-round-trip `f64` floats. Schema/codec
  libraries and JSON frames were rejected: a few dozen lines buys full byte
  control with no dependency. Every wire change appends fields (never
  reorders) and is round-trip tested; compatibility is gated by the contract
  hash (ADR 0004), so mismatches fail loudly, never garble.
- **Clients send intents, never results.** Economy actions (`sell`, `buy`)
  carry only an id; the server re-derives prices, verifies ownership and
  proximity, and the authoritative Gold/inventory ride the snapshot back — a
  rejected trade self-heals with zero client reconciliation.
- **Interact is a one-shot edge end-to-end**: latched on the client until the
  next network send, consumed once per server tick via a pending-edge set.
  Any future press-shaped (vs held) intent must follow this latch-then-edge
  shape — sticky flags get lost or re-fire across the poll/send/tick cadences.
