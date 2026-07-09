import type { AccountRegistry } from './auth';
import { clampCosmetics, DEFAULT_COSMETICS, LEGACY_HAT_IDS } from './cosmetics';
import type { Cosmetics, Item, PlayerProgress } from './types';
import { DEFAULT_WEAPON } from './weapons';
import type { ZoneId } from './world';
import type { ServerAvatar } from './zone';

export interface PlayerSave {
	handle: string;
	progress: PlayerProgress;
	inventory: Item[];
	equippedWeapon: number;
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
		inventory: [],
		equippedWeapon: DEFAULT_WEAPON,
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
		cosmetics: sa.cosmetics,
		lastTown: sa.lastTown ?? fallbackTown,
		bossDefeated: sa.bossDefeated ?? false,
	};
}

export interface RestoredAvatar {
	progress: PlayerProgress;
	inventory: Item[];
	equippedWeapon: number;
	cosmetics: Cosmetics;
	lastTown: ZoneId;
	bossDefeated: boolean;
}

// keyByHandle is case-insensitive, matching claimHandle.
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

// Pre-ADR-0031 Saves stored `hat` as a numeric index into the render-side HATS
// array. Map it through the frozen LEGACY_HAT_IDS order into a sprite id;
// strings (post-migration Saves) pass through unchanged.
export function migrateSaveCosmetics(
	c: Cosmetics | (Omit<Cosmetics, 'hat'> & { hat: number }),
): Cosmetics {
	if (typeof c.hat === 'number') {
		return { ...c, hat: LEGACY_HAT_IDS[c.hat] ?? '' };
	}
	return c as Cosmetics;
}

export function restoredFromSave(save: PlayerSave): RestoredAvatar {
	return {
		progress: save.progress,
		inventory: save.inventory,
		equippedWeapon: save.equippedWeapon,
		cosmetics: clampCosmetics(migrateSaveCosmetics(save.cosmetics)),
		lastTown: save.lastTown,
		bossDefeated: save.bossDefeated,
	};
}
