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
decision for the **sell** loop (#267), the tracer bullet the **buy** loop (#273) and later
Trade / Auction House build on. Buy is the exact mirror of sell and reuses the same
authority model below; the buy-specific notes are called out inline.

The offline shop mutated Gold and inventory *locally* (`sellItem` called straight from
the client, index.ts owning game state). Porting that shape online would mean trusting a
client to report its own balance — the classic dupe/forge vector.

## Decision

- **The client sends an *intent*, not a result.** A `sell` client→server message carries
  only the target `itemId`; the `buy` message carries only the good's `index` into the
  fixed `STARTER_GOODS` catalog (protocol.ts). Neither ever carries a price, a Gold delta,
  or an inventory. The server owns every consequence (ADR 0001/0006).

- **The server validates every trade and re-derives the price.** `applySell`
  (`serverWorld.ts`, pure) gates on three checks, any of which failing makes it a silent
  no-op (`sold: false`, world unchanged): the seller must be standing at a **Merchant** in
  its current Zone (`atMerchant`, the same client-reported position the Portal-interact
  gate trusts), the `itemId` must be in *that session's own* inventory, and the credited
  amount is recomputed from the Item via `saleValue` — never taken from the wire.
  `applyBuy` is the mirror (`bought: false` on failure): the buyer must be at a Merchant,
  the `index` must name a real catalog entry, the price is re-derived from `STARTER_GOODS`
  server-side, and the buy is refused when the Player can't afford it (no debt, no free
  item). The minted Item takes the Avatar's own id source (`nextId`, then advanced) so a
  bought Item never collides with loot. A forged/stale/duplicate request can neither
  conjure Gold nor an Item, nor touch another Player's bag.

- **The logic lives in `@mmo/core` as pure functions.** `applySell`/`applyBuy`/
  `atMerchant` compose the existing pure `sellItem`/`buyItem` + `saleValue`; the server
  handlers are thin adapters. Per CLAUDE.md, one home for the rule means the client (which
  reuses the same `saleValue`/`STARTER_GOODS` only to *display* prices) can't drift from
  the authoritative outcome.

- **Prices sit above sale value, so the shop can't be farmed.** Each `STARTER_GOODS`
  price exceeds the `common` `saleValue`, making a buy-then-sell round-trip a strict net
  Gold loss (regression-tested) — the shop is a sink, never a Gold faucet.

- **Gold + inventory ride the snapshot; the client never mutates them optimistically.**
  They were already in the snapshot (`progress`, `inventory`). The Merchant overlay reads
  them straight off `net.latest` and, on a confirmed sell/buy, simply waits for the next
  snapshot to reflect the change — so a rejected trade self-heals with zero client-side
  reconciliation.

- **A successful trade is a durable, significant event.** The server flushes that
  session's save immediately (#236) rather than waiting for the periodic sweep, so moved
  Gold + the bought Item survive a crash/logout.

## Consequences

- The wire grows two client tags (`sell`, then `buy`); no snapshot change was needed (Gold
  + inventory were already replicated). Backward-compatible: older decoders never see the
  new tags.
- The offline trade path (`sellItem`/`buyItem` from index.ts) still exists until #274
  deletes the offline loop; both call the same pure functions, so they stay consistent
  meanwhile.
- The Merchant overlay is now a full **Sell + Buy** overlay online (#273); gear equipping
  stays frozen (ADR 0024, #275). The `Shop` renderer keeps its `sellOnly` mode for any
  caller that wants a Sell-only Merchant, but the networked path uses the full two-tab
  overlay.
- The proximity gate trusts the client-reported position (ADR 0001) — acceptable because
  the worst case is trading a few cells early, not a value exploit; the ownership /
  affordability / server-derived-price checks are what close the dupe/forge surface.
