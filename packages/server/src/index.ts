// @mmo/server — placeholder for M2 (multiplayer foundation).
//
// M2 will add: a Bun WebSocket server, per-Zone tick loops at ~20Hz (ADR 0001),
// interest-scoped snapshots, client-authoritative movement relay + loose sanity
// checks, and server-authoritative consequences (combat resolution, instanced
// loot, XP/Gold) reusing the deterministic simulation from @mmo/shared.
//
// The shared package is intentionally the single source of game logic so the
// server and client never diverge.
import { createWorld } from "@mmo/shared"

const world = createWorld()
console.log(
  `@mmo/server placeholder — shared sim loads OK ` +
    `(tick ${world.tick}, ${world.monsters.length} monsters). Server arrives in M2.`,
)
