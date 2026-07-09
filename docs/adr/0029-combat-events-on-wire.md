---
status: accepted
---

# CombatEvents cross the wire; presentation projects on the client

ADR 0019 introduced **CombatEvent** (the resolved semantic fact) and **effectsOf**
(the single projection to presentation), and placed that projection *before* the
wire: the server ran `effectsOf` and broadcast the lean **Effect** (born in ADR
0013). That gave the **server presentation knowledge** — it knew a hit "looks like
blood."

We move the projection to *after* the wire. The server resolves combat and
broadcasts the **CombatEvent** itself; each client runs `effectsOf` locally to
realize it into **VisualEffect**s (particles + camera-kick + hitstop) and
**SoundEffect**s. The server holds zero presentation knowledge — "what it looks and
sounds like" is entirely client-owned.

## What is kept from ADR 0019 (do not undo)

CombatEvent stays the single semantic fact, and `effectsOf` stays the **one and
only** projection point — it must NOT be re-inlined at damage sites. That inlining
was the pre-0019 bug (duplicated, drifted emit sites; "particle spam on every active
frame"). `effectsOf` simply now runs on the client instead of the server.

## Authority is unchanged

Clients send **Intents**; the server mints CombatEvents (ADR 0001, Authority model).
A client never authors a CombatEvent — a CombatEvent is a *consequence* (damage,
death), and consequences are the server's. You cannot cheaply "validate" a claimed
hit without recomputing it, and recomputing it *is* producing it. The originator
still predicts its own optimistic `hit` locally and is suppressed from the broadcast
(ADR 0013 §3); `break`/`death`/`swat` remain authority-only.

## Consequences

- The on-wire **Effect** type is retired. The snapshot carries `CombatEvent[]`, not
  `Effect[]`. The client-only realization is renamed **VisualEffect** (CONTEXT.md).
- `effectsOf` migrates from `@mmo/core` to the client `effects/` module. The server
  stops calling it; forge never did.
- The protocol now couples to the `CombatEvent` shape — a combat-model change can be a
  wire change. Accepted in exchange for a presentation-free server and full client
  ownership of looks (the extensible foundation this refactor builds toward).
- Owner/observer agreement (ADR 0019's motivation) is now guaranteed by a client-side
  determinism test: the same CombatEvent projects to the same VisualEffect whether
  predicted by the owner or received by an observer.

Supersedes decision (B) of ADR 0019; retains decision (A). See the amendment note in
ADR 0019.
