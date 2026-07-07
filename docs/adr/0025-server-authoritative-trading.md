---
status: accepted
---

# Trading is server-authoritative: the client sends intents, never economy state

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — Server-authoritative economy,
> Merchant, Gold, Item, Snapshot. Extends the client/server split of
> [ADR 0006](./0006-sim-split-and-wire-protocol.md); the offline loop it replaces
> is retired by the demo freeze ([ADR 0024](./0024-demo-scope-freeze-and-stop-line.md)).

Loot pickup already runs server-side (a killed Monster leaves an instanced Drop the
owner collects on touch, #238), but the *only* shop/inventory UI lived in the offline
single-player loop (`runOffline`, being deleted in #274). So online a Player collects
loot that does nothing — there is no way to turn it into Gold. This ADR records the
decision for the **sell** loop (#267), the tracer bullet the buy path (#273) and later
Trade / Auction House build on.

The offline shop mutated Gold and inventory *locally* (`sellItem` called straight from
the client, index.ts owning game state). Porting that shape online would mean trusting a
client to report its own balance — the classic dupe/forge vector.

## Decision

- **The client sends an *intent*, not a result.** A new `sell` client→server message
  carries only the target `itemId` (protocol.ts). It never carries a price, a Gold
  delta, or an inventory. The server owns every consequence (ADR 0001/0006).

- **The server validates every sell and re-derives the price.** `applySell`
  (`serverWorld.ts`, pure) gates the transaction on three checks, any of which failing
  makes it a silent no-op (`sold: false`, world unchanged): the seller must be standing
  at a **Merchant** in its current Zone (`atMerchant`, the same client-reported position
  the Portal-interact gate trusts), the `itemId` must be in *that session's own*
  inventory, and the credited amount is recomputed from the Item via `saleValue` — never
  taken from the wire. A forged/stale/duplicate request can neither conjure Gold nor
  touch another Player's bag.

- **The logic lives in `@mmo/shared` as pure functions.** `applySell` /`atMerchant`
  compose the existing pure `sellItem` + `saleValue`; the server handler is a thin
  adapter. Per CLAUDE.md, one home for the rule means the client (which reuses the same
  `saleValue` only to *display* prices) can't drift from the authoritative outcome.

- **Gold + inventory ride the snapshot; the client never mutates them optimistically.**
  They were already in the snapshot (`progress`, `inventory`). The Merchant overlay reads
  them straight off `net.latest` and, on a confirmed sell, simply waits for the next
  snapshot to reflect the removal — so a rejected sell self-heals with zero client-side
  reconciliation.

- **A successful sell is a durable, significant event.** The server flushes that
  session's save immediately (#236) rather than waiting for the periodic sweep, so moved
  Gold survives a crash/logout.

## Consequences

- The wire grows one client tag (`sell`); no snapshot change was needed (Gold + inventory
  were already replicated). Backward-compatible: older decoders never see the new tag.
- The offline sell path (`sellItem` from index.ts) still exists until #274 deletes the
  offline loop; both call the same pure `sellItem`, so they stay consistent meanwhile.
- The Merchant overlay is **sell-only** online: buying starter goods is deferred to #273,
  and gear equipping stays frozen (ADR 0024, #275). The `Shop` renderer gained a
  `sellOnly` mode so the Buy tab isn't advertised where it can't function.
- The proximity gate trusts the client-reported position (ADR 0001) — acceptable because
  the worst case is selling one's *own* loot a few cells early, not a value exploit; the
  ownership + server-derived-price checks are what close the dupe/forge surface.
