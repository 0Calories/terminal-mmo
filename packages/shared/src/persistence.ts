// Durable player-state persistence (#236, keyed by the ADR 0004 account identity).
// Everything here is pure and storage-free: the `PlayerSave` shape, the `PlayerStore`
// seam the server implements with bun:sqlite, and the two transforms that lift a live
// `ServerAvatar` to a save and restore a save back onto a spawned Avatar. Keeping the
// seam and the transforms pure means the sqlite store sits entirely behind the interface
// — the round-trip is unit-tested against an in-memory database, and the shared package's
// no-IO contract holds (bun:sqlite lives in @mmo/server).
//
// What is durable (and only this): the Avatar's level/XP/Gold, its inventory + equipped
// Weapon, its cosmetics (Form/hue/hat/nameplate), the last safe Town it stood in, and a
// boss-defeated flag (plumbing only — the Boss epic wires the trigger that sets it).
// Deliberately NOT persisted: Monsters, transient Zone state, and the exact live position
// — a returning Player is restored to their last Town, not dropped where they logged off.

import type { AccountRegistry } from './auth';
import { clampCosmetics, DEFAULT_COSMETICS } from './cosmetics';
import type { Cosmetics, Item, PlayerProgress } from './types';
import { DEFAULT_WEAPON } from './weapons';
import type { ZoneId } from './world';
import type { ServerAvatar } from './zone';

// The persisted account snapshot: exactly the state that must survive a restart, keyed
// by the account's canonical public key (`canonicalPublicKey`). Position, HP, and every
// transient combat timer are intentionally absent — login rebuilds those from scratch and
// returns the Avatar to `lastTown`.
export interface PlayerSave {
	// The durable Handle (ADR 0004): stored alongside the state so the store can also
	// rebuild the account registry (public key ↔ Handle) on startup.
	handle: string;
	// Level / XP / Gold as the one `PlayerProgress` the rest of the codebase already uses,
	// so the persisted trio can't drift from the live shape it mirrors.
	progress: PlayerProgress;
	inventory: Item[];
	// The equipped Weapon's catalog index (ADR 0024): the one "equipped Item" the current
	// model carries — it drives both the swing's damage and the broadcast appearance.
	equippedWeapon: number;
	cosmetics: Cosmetics;
	// The Zone id of the last safe Town the Avatar stood in — where login returns them.
	lastTown: ZoneId;
	// Plumbing only (#236): the Boss epic later wires the trigger that flips this to true.
	// It rides the save so the flag survives a restart the moment that trigger exists.
	bossDefeated: boolean;
}

/**
 * The persistence seam (#236): a narrow store keyed by canonical public key. The server
 * backs it with bun:sqlite; tests back it with an in-memory sqlite. Pure logic never
 * touches it — it is called only at login (load), on significant events + a periodic
 * flush (save), and at startup (loadRegistry), never per-tick.
 */
export interface PlayerStore {
	// The saved state for an account, or undefined for a key that has never been seen.
	load(key: string): PlayerSave | undefined;
	// Upsert an account's state, keyed by its canonical public key.
	save(key: string, save: PlayerSave): void;
	// Every persisted account as `[key, save]`, so the server can rebuild the in-memory
	// account registry (public key ↔ Handle) after a restart.
	all(): Array<[string, PlayerSave]>;
	// Release the underlying handle (a no-op for a pure/in-memory backing).
	close(): void;
}

// A brand-new account's save: level 1, empty pockets, default look, no boss cleared,
// returning to `town`. Written on first claim so the Handle persists immediately.
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

// Lift a live Avatar to its durable save — the flush/logout direction. Reads only the
// persisted fields off the ServerAvatar; the transient position/HP/timers are dropped.
// `fallbackTown` is used when the Avatar has not yet stood in a Town (it should always
// have, since sessions spawn into one).
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

// The restored progress + inventory to seed a freshly spawned Avatar with on login (the
// load direction). Cosmetics are clamped at the trust boundary — a save written by an
// older/forward catalog can never produce an out-of-range lookup.
export interface RestoredAvatar {
	progress: PlayerProgress;
	inventory: Item[];
	equippedWeapon: number;
	cosmetics: Cosmetics;
	lastTown: ZoneId;
	bossDefeated: boolean;
}

// Rebuild the account registry (public key ↔ Handle) from every persisted save — how the
// server restores the ADR 0004 claim registry after a restart, so a returning key still
// resolves to the Handle it claimed. The registry key IS each save's storage key (the
// canonical public key); the reverse index is case-insensitive, matching `claimHandle`.
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
