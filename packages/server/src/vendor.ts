import { aabbOverlap } from '@mmo/core/combat';
import {
	buyItem,
	itemLabel,
	STARTER_GOODS,
	saleValue,
	sellItem,
} from '@mmo/core/items';
import {
	avatarBox,
	type ServerWorld,
	updateAvatar,
	zoneStateOf,
} from '@mmo/core/world';

function placedAtMerchant(world: ServerWorld, sessionId: number) {
	const zs = zoneStateOf(world, sessionId);
	const sa = zs?.avatars.find((a) => a.sessionId === sessionId);
	if (zs === undefined || sa === undefined) return undefined;
	const box = avatarBox(sa.avatar.x, sa.avatar.y);
	const near = (zs.zone.npcs ?? []).some(
		(n) => n.kind === 'vendor' && aabbOverlap(box, n),
	);
	return near ? sa : undefined;
}

export function atMerchant(world: ServerWorld, sessionId: number): boolean {
	return placedAtMerchant(world, sessionId) !== undefined;
}

export function applySell(
	world: ServerWorld,
	sessionId: number,
	itemId: number,
): { world: ServerWorld; sold: boolean } {
	const sa = placedAtMerchant(world, sessionId);
	if (sa === undefined) return { world, sold: false };
	const item = sa.inventory.find((i) => i.id === itemId);
	if (item === undefined) return { world, sold: false };
	const { progress, inventory } = sellItem(sa.progress, sa.inventory, itemId);
	const next = updateAvatar(world, sessionId, (a) => ({
		...a,
		progress,
		inventory,
		log: [
			...a.log.slice(-5),
			`Sold ${itemLabel(item)} (+${saleValue(item)}g).`,
		],
	}));
	return { world: next, sold: true };
}

export function applyBuy(
	world: ServerWorld,
	sessionId: number,
	index: number,
): { world: ServerWorld; bought: boolean } {
	const good = STARTER_GOODS[index];
	if (good === undefined) return { world, bought: false };
	const sa = placedAtMerchant(world, sessionId);
	if (sa === undefined) return { world, bought: false };
	const { progress, inventory, bought } = buyItem(
		sa.progress,
		sa.inventory,
		good,
		sa.nextId,
	);
	if (!bought) return { world, bought: false };
	const next = updateAvatar(world, sessionId, (a) => ({
		...a,
		progress,
		inventory,
		nextId: a.nextId + 1,
		log: [...a.log.slice(-5), `Bought ${good.base} (−${good.price}g).`],
	}));
	return { world: next, bought: true };
}
