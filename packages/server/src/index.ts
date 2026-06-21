// @mmo/server — placeholder for M2 (multiplayer foundation).
import { activeZone, createGame } from '@mmo/shared';

const game = createGame();
const zone = activeZone(game.world, game.player.zoneId);
console.log(
	`@mmo/server placeholder — shared sim loads OK ` +
		`(tick ${game.world.tick}, ${zone.monsters.length} monsters in ${zone.id}). Server arrives in M2.`,
);
