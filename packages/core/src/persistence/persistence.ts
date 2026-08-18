import { DEFAULT_WEAPON } from '../combat/weapons';
import {
	clampCosmetics,
	DEFAULT_COSMETICS,
	DEFAULT_FORM_ID,
	LEGACY_FORM_IDS,
	LEGACY_HAT_IDS,
} from '../entities/cosmetics';
import type { Cosmetics, Item, PlayerProgress } from '../entities/types';
import { STARTER_SHIELD, starterShieldItem } from '../items/shields';
import type { ZoneId } from '../zones/types';
import type { ServerAvatar } from '../zones/zone';
import type { AccountRegistry } from './auth';

export interface PlayerSave {
	handle: string;
	progress: PlayerProgress;
	inventory: Item[];
	equippedWeapon: number;
	equippedOffhand?: number;
	cosmetics: Cosmetics;
	lastTown: ZoneId;
	bossDefeated: boolean;
}

export interface PlayerStore {
	load(key: string): PlayerSave | undefined;
	save(key: string, save: PlayerSave): void;
	all(): Array<[string, PlayerSave]>;
	close(): void;
}

export function emptySave(handle: string, town: ZoneId): PlayerSave {
	return {
		handle,
		progress: { level: 1, xp: 0, gold: 0 },
		inventory: [starterShieldItem(1)],
		equippedWeapon: DEFAULT_WEAPON,
		equippedOffhand: STARTER_SHIELD,
		cosmetics: DEFAULT_COSMETICS,
		lastTown: town,
		bossDefeated: false,
	};
}

export function saveFromAvatar(
	sa: ServerAvatar,
	fallbackTown: ZoneId,
): PlayerSave {
	return {
		handle: sa.handle,
		progress: sa.progress,
		inventory: sa.inventory,
		equippedWeapon: sa.avatar.weapon ?? DEFAULT_WEAPON,
		...(sa.avatar.offhand !== undefined
			? { equippedOffhand: sa.avatar.offhand }
			: {}),
		cosmetics: sa.cosmetics,
		lastTown: sa.lastTown ?? fallbackTown,
		bossDefeated: sa.bossDefeated ?? false,
	};
}

export interface RestoredAvatar {
	progress: PlayerProgress;
	inventory: Item[];
	equippedWeapon: number;
	equippedOffhand?: number;
	cosmetics: Cosmetics;
	lastTown: ZoneId;
	bossDefeated: boolean;
}

export function registryFromSaves(
	entries: Array<[string, PlayerSave]>,
): AccountRegistry {
	const handleByKey: Record<string, string> = {};
	const keyByHandle: Record<string, string> = {};
	for (const [key, save] of entries) {
		handleByKey[key] = save.handle;
		keyByHandle[save.handle.toLowerCase()] = key;
	}
	return { handleByKey, keyByHandle };
}

type LegacyCosmetics = {
	hue: number;
	hat: string | number;
	nameplate: number;
	form: string | number;
};
export function migrateSaveCosmetics(c: LegacyCosmetics): Cosmetics {
	return {
		hue: c.hue,
		hat: typeof c.hat === 'number' ? (LEGACY_HAT_IDS[c.hat] ?? '') : c.hat,
		nameplate: c.nameplate,
		form:
			typeof c.form === 'number'
				? (LEGACY_FORM_IDS[c.form] ?? DEFAULT_FORM_ID)
				: c.form,
	};
}

function nextItemId(inventory: Item[]): number {
	return inventory.reduce((n, it) => Math.max(n, it.id), 0) + 1;
}

export function restoredFromSave(save: PlayerSave): RestoredAvatar {
	// A save with no offhand-slot Item predates shields and gets the starter
	// grant; one that has the Item but no equippedOffhand chose to unequip.
	const hasOffhandItem = save.inventory.some((i) => i.slot === 'offhand');
	const inventory = hasOffhandItem
		? save.inventory
		: [...save.inventory, starterShieldItem(nextItemId(save.inventory))];
	const equippedOffhand = hasOffhandItem
		? save.equippedOffhand
		: STARTER_SHIELD;
	return {
		progress: save.progress,
		inventory,
		equippedWeapon: save.equippedWeapon,
		...(equippedOffhand !== undefined ? { equippedOffhand } : {}),
		cosmetics: clampCosmetics(migrateSaveCosmetics(save.cosmetics)),
		lastTown: save.lastTown,
		bossDefeated: save.bossDefeated,
	};
}
