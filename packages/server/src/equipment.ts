import type { Slot } from '@mmo/core/entities';
import { itemLabel, shieldIdByName } from '@mmo/core/items';
import { avatarOf, type ServerWorld, updateAvatar } from '@mmo/core/world';

export function applyEquip(
	world: ServerWorld,
	sessionId: number,
	itemId: number,
): { world: ServerWorld; changed: boolean } {
	const sa = avatarOf(world, sessionId);
	const item = sa?.inventory.find((i) => i.id === itemId);
	if (sa === undefined || item === undefined || item.slot !== 'offhand')
		return { world, changed: false };
	const shield = shieldIdByName(item.base);
	if (shield === undefined || sa.avatar.offhand === shield)
		return { world, changed: false };
	const next = updateAvatar(world, sessionId, (a) => ({
		...a,
		avatar: { ...a.avatar, offhand: shield },
		log: [...a.log.slice(-5), `Equipped ${itemLabel(item)}.`],
	}));
	return { world: next, changed: true };
}

export function applyUnequip(
	world: ServerWorld,
	sessionId: number,
	slot: Slot,
): { world: ServerWorld; changed: boolean } {
	if (slot !== 'offhand') return { world, changed: false };
	const sa = avatarOf(world, sessionId);
	if (sa === undefined || sa.avatar.offhand === undefined)
		return { world, changed: false };
	const next = updateAvatar(world, sessionId, (a) => {
		const { offhand: _offhand, ...bare } = a.avatar;
		return {
			...a,
			avatar: bare,
			log: [...a.log.slice(-5), 'Unequipped your offhand.'],
		};
	});
	return { world: next, changed: true };
}
