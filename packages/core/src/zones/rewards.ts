import type { CombatEvent } from '../combat/combat';
import { deathEvent } from '../combat/combat';
import { skillsUnlockedBetween } from '../combat/skills';
import { BOX } from '../entities/archetypes';
import type {
	Drop,
	Entity,
	EntityType,
	Item,
	PendingRespawn,
} from '../entities/types';
import { LOOT } from '../items/constants';
import { type LootTable, rollDrop } from '../items/loot';
import { applyXp, maxHpForLevel, xpForKill } from '../progression/progression';
import { RESPAWN } from './constants';
import type { ZoneId } from './types';
import type { ServerAvatar } from './zone';

export function resolveDeaths(
	avatars: ServerAvatar[],
	deadMonsters: Entity[],
	ctx: { zoneId: ZoneId; lootTable: LootTable; nextDropId: number },
): {
	avatars: ServerAvatar[];
	drops: Drop[];
	nextDropId: number;
	respawns: PendingRespawn[];
	deaths: number[];
	events: CombatEvent[];
} {
	const next = avatars.slice();
	const drops: Drop[] = [];
	const respawns: PendingRespawn[] = [];
	let nextDropId = ctx.nextDropId;
	for (const m of deadMonsters) {
		for (const sid of m.contributors ?? []) {
			const idx = next.findIndex((a) => a.sessionId === sid);
			if (idx < 0) continue;
			let sa = grantXp(next[idx], m.type, ctx.zoneId);
			const roll = rollDrop(sa.rngState, sa.progress.level, ctx.lootTable);
			sa = { ...sa, rngState: roll.state };
			if (roll.item) {
				drops.push(
					spawnDrop(nextDropId++, sid, m, { ...roll.item, id: sa.nextId }),
				);
				sa = { ...sa, nextId: sa.nextId + 1 };
			}
			next[idx] = sa;
		}
		if (m.spawnIndex !== undefined)
			respawns.push({ spawnIndex: m.spawnIndex, remaining: RESPAWN.delaySec });
	}

	const deaths: number[] = [];
	const events: CombatEvent[] = [];
	for (const sa of next) {
		if (sa.avatar.hp <= 0) {
			deaths.push(sa.sessionId);
			events.push(deathEvent(sa.avatar));
		}
	}

	return { avatars: next, drops, nextDropId, respawns, deaths, events };
}

function grantXp(
	sa: ServerAvatar,
	monster: EntityType,
	zoneId: string,
): ServerAvatar {
	const ap = applyXp(sa.progress, xpForKill(monster, zoneId));
	const log = [...sa.log];
	let avatar = sa.avatar;
	if (ap.leveled > 0) {
		const mhp = maxHpForLevel(ap.progress.level);
		avatar = { ...avatar, maxHp: mhp, hp: mhp };
		log.push(`Level up! Now level ${ap.progress.level}.`);
		for (const skill of skillsUnlockedBetween(
			sa.class ?? 'warrior',
			sa.progress.level,
			ap.progress.level,
		))
			log.push(`Unlocked: ${skill.name} [${skill.key}]!`);
	}
	return { ...sa, avatar, progress: ap.progress, log };
}

function spawnDrop(id: number, owner: number, m: Entity, item: Item): Drop {
	return {
		id,
		owner,
		item,
		x: m.x + BOX.w / 2 - LOOT.pickup.w / 2,
		y: m.y + BOX.h - LOOT.pickup.h,
		w: LOOT.pickup.w,
		h: LOOT.pickup.h,
		ttl: LOOT.ttlSec,
	};
}
