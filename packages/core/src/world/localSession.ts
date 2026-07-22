import { canStartDodge } from '../combat/combat';
import { COMBAT } from '../combat/constants';
import type { Input } from '../entities/types';
import { PHYS } from '../physics/constants';
import { applyImpulse, stepEntity } from '../physics/physics';
import { capabilityUnlocked } from '../progression/progression';
import type { Zone, ZoneId } from '../zones/types';
import {
	type AvatarIntent,
	createZoneState,
	type ServerAvatar,
	type ZoneState,
} from '../zones/zone';
import {
	addSession,
	createServerWorld,
	instanceKey,
	type ServerWorld,
	stepServerWorld,
	zoneStateOf,
} from './serverWorld';
import { addAvatar } from './session';

export interface LocalWorld {
	world: ServerWorld;
	sessionId: number;
}

const LOCAL_SESSION = 1;

export function createLocalWorld(
	zones: Zone[],
	start: ZoneId,
	handle = 'you',
): LocalWorld {
	const startId = zones.some((z) => z.id === start) ? start : zones[0].id;

	const town = zones.find((z) => z.type === 'town')?.id ?? startId;
	const world = createServerWorld({ zones, start: startId, town });
	if (world.templates[startId].type === 'dungeon') {
		const key = instanceKey(startId, LOCAL_SESSION);
		const inst = addAvatar(
			createZoneState(world.templates[startId]),
			LOCAL_SESSION,
			handle,
		);
		return {
			sessionId: LOCAL_SESSION,
			world: {
				...world,
				instances: { [key]: inst },
				instanceOf: { [LOCAL_SESSION]: key },
				location: { [LOCAL_SESSION]: startId },
			},
		};
	}
	return {
		sessionId: LOCAL_SESSION,
		world: addSession(world, LOCAL_SESSION, handle),
	};
}

export function localZoneState(lw: LocalWorld): ZoneState | undefined {
	return zoneStateOf(lw.world, lw.sessionId);
}

export function localAvatar(lw: LocalWorld): ServerAvatar | undefined {
	return localZoneState(lw)?.avatars.find((a) => a.sessionId === lw.sessionId);
}

export function stepLocalWorld(
	lw: LocalWorld,
	input: Input,
	dtMs: number,
): LocalWorld {
	const zs = localZoneState(lw);
	const me = localAvatar(lw);
	if (zs === undefined || me === undefined) return lw;
	const dt = Math.min(dtMs / 1000, PHYS.maxDt);

	const dodging =
		(input.dodge ?? false) &&
		canStartDodge(me.avatar, input.moveX) &&
		capabilityUnlocked('dodge', me.progress.level);
	const body = dodging
		? applyImpulse(
				me.avatar,
				input.moveX * COMBAT.dodge.impulse,
				-COMBAT.dodge.up,
			)
		: me.avatar;
	const predicted = stepEntity(
		zs.zone.terrain,
		body,
		{ moveX: input.moveX, jump: input.jump },
		dt,
	).e;

	const intent: AvatarIntent = {
		sessionId: lw.sessionId,
		x: predicted.x,
		y: predicted.y,
		vx: predicted.vx,
		vy: predicted.vy,

		ivx: predicted.ivx,
		facing: predicted.facing,
		onGround: predicted.onGround,
		attack: input.attack,
		dodge: dodging,
		guard: input.guard,
		skill: input.skill,
		interact: input.interact,
	};
	return { ...lw, world: stepServerWorld(lw.world, [intent], dtMs) };
}
