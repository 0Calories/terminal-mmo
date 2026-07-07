---
status: accepted
---

# Interact is a one-shot edge end-to-end: client latch, server pending-edge

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — Interact edge, Portal, Snapshot.
> Extends the client/server input path of
> [ADR 0006](./0006-sim-split-and-wire-protocol.md) and completes the edge-trigger
> #261 introduced. A fix-forward within the demo freeze
> ([ADR 0024](./0024-demo-scope-freeze-and-stop-line.md)).

#261 made `interact` fire on the **rising edge** — true for exactly one poll per
physical press — so standing on a Portal (or a merchant) no longer re-triggers every
frame. That was correct in the offline loop where poll and consume were the same
step. Networked (offline removed in #274), the press has to survive two cadence gaps
it did not before, and manual QA on v0.5.0 reported the result bluntly: **portals
don't fire at all.**

Two independent losses, both from a one-tick pulse meeting a slower sampler:

1. **Client poll ≫ send.** The render loop polls input at up to 120 Hz but reports to
   the server at ~30 Hz. `poll()` consumed the edge every frame, so ~3 of every 4
   presses were spent on a non-send frame and never reached the wire.
2. **Server tick samples a sticky flag.** The server keeps the last reported intent
   in a map and reuses it every tick (20 Hz). Even a delivered pulse sat on the wire
   only ~33 ms, which a 50 ms tick misses ~a third of the time; and a flag that *did*
   stick would re-fire the Portal every tick it stayed set.

This matters more than it looks because the Field→Town **arrival point overlaps the
Town's return Portal** (#90, intentionally left alone). So interact firing *exactly
once per press* is not a nicety — it is the only thing stopping a held/re-sampled
interact from ping-ponging the Avatar between zones. The edge must be lossless AND
single-shot.

## Decision

Make interact a one-shot edge along the whole path, latched where the cadence
changes and consumed once where it is used.

- **Client latches the edge until the send, not the poll.** `poll()` no longer
  touches the interact edge; `InputState.consumeInteract()` reads-and-clears it and is
  called **once per network send**. A press latched between two sends therefore
  reaches the wire exactly once, whatever the render frame rate. It is drained (and
  reported false) while a modal owns the keyboard, so a press latched just before a
  menu opens can't fire a Portal from under it; `clear()` still resets it.

- **Server treats interact as a pending edge, not a sticky intent** — the same idiom
  as body emotes (ADR 0020 §9). An input frame reporting `interact` adds the session
  to a `pendingInteract` set; `interact` is *not* stored on the reused per-session
  intent. Each tick folds any pending edge onto that session's intent once and
  consumes it. One press ⇒ one tick ⇒ one Portal transfer, and a flag can neither
  be tick-sampled away nor re-fire.

- **Arrival positioning is untouched.** The overlapping arrival (#90) is left as-is;
  the once-per-edge guarantee above is what keeps it safe, and a regression test
  (`serverWorld.test.ts`) pins that a single edge transfers once and does not bounce.

## Consequences

- Portals fire once per press again — the #261 behaviour, now robust to the
  networked poll/send/tick cadences.
- The client `Input` no longer carries `interact` out of `poll()`; the send path
  reads it from `consumeInteract()`. Any future intent that is a *press* rather than a
  *hold* should follow this latch-then-edge shape, not ride the sticky intent.
- The Field→Town arrival still overlaps the return Portal by design; this ADR records
  that the edge-once semantics are load-bearing for it.
