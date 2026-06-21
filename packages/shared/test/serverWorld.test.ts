import { expect, test } from 'bun:test';
import type { AvatarIntent, ServerWorld } from '../src';
import {
	addSession,
	BOX,
	createServerWorld,
	createZoneState,
	GROUND_TOP,
	makeFieldZone,
	makeTownZone,
	removeSession,
	stepServerWorld,
	TOWN_SPAWN,
	worldSnapshotFor,
	zoneOf,
} from '../src';

const y = GROUND_TOP - BOX.h;

function makeWorld(): ServerWorld {
	return createServerWorld({
		zones: [
			createZoneState(makeFieldZone('field-01')),
			createZoneState(makeTownZone('town-01')),
		],
		start: 'field-01',
		town: 'town-01',
	});
}

// Report the Avatar holding still at (x, y), no combat or portal intent.
function holdAt(sessionId: number, x: number, interact = false): AvatarIntent {
	return {
		sessionId,
		x,
		y,
		vx: 0,
		vy: 0,
		facing: 1,
		onGround: true,
		attack: false,
		interact,
	};
}

test('addSession places a new session in the start Zone with its handle', () => {
	const w = addSession(makeWorld(), 7, 'neo');
	expect(zoneOf(w, 7)).toBe('field-01');
	const here = w.zones['field-01'].avatars.find((a) => a.sessionId === 7);
	expect(here?.handle).toBe('neo');
	expect(w.zones['town-01'].avatars.length).toBe(0);
});

test('stepServerWorld advances every Zone independently each tick', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = stepServerWorld(w, [holdAt(7, 20)], 16);
	expect(w.zones['field-01'].tick).toBe(1);
	expect(w.zones['town-01'].tick).toBe(1); // empty Zones still run their own loop
});

test('entering a Portal transfers the session to the target Zone at the arrival point', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const fieldPortal = w.zones['field-01'].zone.portals[0];
	// Stand on the Field->Town portal and press interact.
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);

	expect(zoneOf(w, 7)).toBe('town-01');
	expect(w.zones['field-01'].avatars.some((a) => a.sessionId === 7)).toBe(
		false,
	);
	const moved = w.zones['town-01'].avatars.find((a) => a.sessionId === 7);
	expect(moved?.avatar.x).toBe(fieldPortal.arrival.x);
	expect(moved?.avatar.y).toBe(fieldPortal.arrival.y);
});

test('a session receives snapshots for only its current Zone', () => {
	let w = addSession(makeWorld(), 7, 'neo'); // mover
	w = addSession(w, 8, 'trinity'); // stays in the Field
	const fieldPortal = w.zones['field-01'].zone.portals[0];
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true), holdAt(8, 60)], 16);

	const moverView = worldSnapshotFor(w, 7);
	expect(moverView.zoneId).toBe('town-01');
	expect(moverView.avatars.some((a) => a.sessionId === 7)).toBe(true);

	const stayerView = worldSnapshotFor(w, 8);
	expect(stayerView.zoneId).toBe('field-01');
	// the stayer no longer sees the session that left for Town
	expect(stayerView.avatars.some((a) => a.sessionId === 7)).toBe(false);
});

test('progress and inventory survive a Portal transfer', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const before = w.zones['field-01'].avatars[0];
	before.progress = { level: 5, xp: 40, gold: 99 };
	before.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'epic', affixes: [] },
	];
	const fieldPortal = w.zones['field-01'].zone.portals[0];
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);

	const moved = w.zones['town-01'].avatars.find((a) => a.sessionId === 7);
	expect(moved?.progress).toEqual({ level: 5, xp: 40, gold: 99 });
	expect(moved?.inventory.length).toBe(1);
});

test('a forgiving death respawns the Avatar in Town with full HP and no loss', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const av = w.zones['field-01'].avatars[0];
	av.avatar.hp = 1;
	av.progress = { level: 4, xp: 20, gold: 50 };
	av.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'rare', affixes: [] },
	];
	// Stand on a Field Monster so its contact damage finishes the Avatar this tick.
	const m = w.zones['field-01'].zone.monsters[0];
	w = stepServerWorld(w, [holdAt(7, m.x)], 16);

	expect(zoneOf(w, 7)).toBe('town-01');
	expect(w.zones['field-01'].avatars.some((a) => a.sessionId === 7)).toBe(
		false,
	);
	const moved = w.zones['town-01'].avatars.find((a) => a.sessionId === 7);
	expect(moved?.avatar.hp).toBe(moved?.avatar.maxHp); // full HP
	expect(moved?.avatar.x).toBe(TOWN_SPAWN.x);
	expect(moved?.progress).toEqual({ level: 4, xp: 20, gold: 50 }); // no XP/Gold loss
	expect(moved?.inventory.length).toBe(1); // no Item loss
});

test('stepServerWorld is deterministic for an identical world + intents', () => {
	const run = () => {
		const w = addSession(makeWorld(), 7, 'neo');
		const portal = w.zones['field-01'].zone.portals[0];
		return stepServerWorld(w, [holdAt(7, portal.x, true)], 16);
	};
	const a = run();
	const b = run();
	expect(zoneOf(b, 7)).toBe(zoneOf(a, 7));
	const am = a.zones['town-01'].avatars.find((x) => x.sessionId === 7);
	const bm = b.zones['town-01'].avatars.find((x) => x.sessionId === 7);
	expect(bm?.avatar.x).toBe(am?.avatar.x);
	expect(bm?.avatar.y).toBe(am?.avatar.y);
});

test('removeSession drops a disconnected session from its Zone and the map', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = removeSession(w, 7);
	expect(zoneOf(w, 7)).toBeUndefined();
	expect(w.zones['field-01'].avatars.length).toBe(0);
	expect(removeSession(w, 99)).toBe(w); // unknown session is a no-op
});
