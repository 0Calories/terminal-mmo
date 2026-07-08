// Durable player-state persistence: the `PlayerSave` shape, the `PlayerStore` seam the
// server backs with bun:sqlite, and the transforms between a live `ServerAvatar` and a
// save (#236, ADR 0004 identity). NOT persisted: Monsters, transient Zone state, and live
// position — a returning Player is restored to their last Town, not where they logged off.

import type { AccountRegistry } from './auth';
import { clampCosmetics, DEFAULT_COSMETICS } from './cosmetics';
import type { Cosmetics, Item, PlayerProgress } from './types';
import { DEFAULT_WEAPON } from './weapons';
import type { ZoneId } from './world';
import type { ServerAvatar } from './zone';

// The persisted account snapshot, keyed by canonical public key. Position, HP, and every
// transient combat timer are intentionally absent — login rebuilds those and returns the
// Avatar to `lastTown`.
export interface PlayerSave {
	// Stored alongside the state so the store can rebuild the account registry
	// (public key ↔ Handle) on startup (ADR 0004).
	handle: string;
	// Reuses the live `PlayerProgress` shape so the persisted trio can't drift from it.
	progress: PlayerProgress;
	inventory: Item[];
	// The equipped Weapon's catalog index — drives both swing damage and appearance (ADR 0024).
	equippedWeapon: number;
	cosmetics: Cosmetics;
	// The last safe Town — where login returns the Avatar.
	lastTown: ZoneId;
	// Plumbing only (#236): the Boss epic wires the trigger that flips this; it rides the
	// save so the flag survives a restart once that exists.
	bossDefeated: boolean;
}

/**
 * The persistence seam: a narrow store keyed by canonical public key, backed by bun:sqlite
 * (in-memory in tests). Called only at login (load), on significant events + a periodic
 * flush (save), and at startup — never per-tick (#236).
 */
export interface PlayerStore {
	// The saved state for an account, or undefined for a key never seen.
	load(key: string): PlayerSave | undefined;
	// Upsert an account's state.
	save(key: string, save: PlayerSave): void;
	// Every persisted account as `[key, save]`, so the server can rebuild the in-memory
	// account registry (public key ↔ Handle) after a restart.
	all(): Array<[string, PlayerSave]>;
	// Release the underlying handle (a no-op for a pure/in-memory backing).
	close(): void;
}

// A brand-new account's save. Written on first claim so the Handle persists immediately.
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

// Lift a live Avatar to its durable save (flush/logout). `fallbackTown` covers an Avatar
// that has not yet stood in a Town (it should always have, since sessions spawn into one).
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

// The restored state to seed a freshly spawned Avatar on login. Cosmetics are clamped at
// the trust boundary — a save from an older/forward catalog can't produce an out-of-range
// lookup.
export interface RestoredAvatar {
	progress: PlayerProgress;
	inventory: Item[];
	equippedWeapon: number;
	cosmetics: Cosmetics;
	lastTown: ZoneId;
	bossDefeated: boolean;
}

// Rebuild the account registry (public key ↔ Handle) from every persisted save, so a
// returning key still resolves to the Handle it claimed after a restart. The reverse
// index is case-insensitive, matching `claimHandle` (ADR 0004).
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

export function restoredFromSave(save: PlayerSave): RestoredAvatar {
	return {
		progress: save.progress,
		inventory: save.inventory,
		equippedWeapon: save.equippedWeapon,
		cosmetics: clampCosmetics(save.cosmetics),
		lastTown: save.lastTown,
		bossDefeated: save.bossDefeated,
	};
}
