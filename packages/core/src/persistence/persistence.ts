import { DEFAULT_WEAPON } from '../combat/weapons';
import {
	clampCosmetics,
	DEFAULT_COSMETICS,
	DEFAULT_FORM_ID,
	LEGACY_FORM_IDS,
	LEGACY_HAT_IDS,
} from '../entities/cosmetics';
import type { Cosmetics, Item, PlayerProgress } from '../entities/types';
import type { ZoneId } from '../world/world';
import type { ServerAvatar } from '../zones/zone';
import type { AccountRegistry } from './auth';

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

// Pre-ADR-0031 Saves stored `hat` and `form` as numeric indices into the
// render-side HATS / FORMS arrays. Map each through its frozen legacy order into
// a sprite id; strings (post-migration Saves) pass through unchanged, so an
// already-migrated Save is a no-op.
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
