// @mmo/server — placeholder for M2 (multiplayer foundation).
//
// M2 will add: a Bun WebSocket server, per-Zone tick loops at ~20Hz (ADR 0001),
// interest-scoped snapshots, client-authoritative movement relay + loose sanity
// checks, and server-authoritative consequences (combat resolution, instanced
// loot, XP/Gold) reusing the deterministic simulation from @mmo/shared.
//
// The shared package is intentionally the single source of game logic so the
// server and client never diverge.
import { activeZone, createGame } from "@mmo/shared"

const game = createGame()
const zone = activeZone(game.world, game.player.zoneId)
console.log(
  `@mmo/server placeholder — shared sim loads OK ` +
    `(tick ${game.world.tick}, ${zone.monsters.length} monsters in ${zone.id}). Server arrives in M2.`,
)
