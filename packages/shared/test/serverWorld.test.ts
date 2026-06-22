import { expect, test } from 'bun:test';
import type { AvatarIntent, ServerWorld } from '../src';
import {
	addSession,
	BOX,
	channelOf,
	channelsOf,
	createServerWorld,
	GROUND_TOP,
	loadZones,
	removeSession,
	sessionsInChannel,
	stepServerWorld,
	TOWN_SPAWN,
	worldSnapshotFor,
	zoneOf,
	zoneStateOf,
} from '../src';

const y = GROUND_TOP - BOX.h;

// A world with a generous soft cap (single-session tests never split a Channel).
function makeWorld(cap = 50): ServerWorld {
	return createServerWorld({
		zones: loadZones(),
		start: 'field-01',
		town: 'town-01',
		cap,
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
	expect(channelOf(w, 7)).toBe(0);
	const here = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(here?.handle).toBe('neo');
	expect(channelsOf(w, 'town-01')[0].avatars.length).toBe(0);
});

test('stepServerWorld advances every Channel independently each tick', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = stepServerWorld(w, [holdAt(7, 20)], 16);
	expect(channelsOf(w, 'field-01')[0].tick).toBe(1);
	expect(channelsOf(w, 'town-01')[0].tick).toBe(1); // empty Channels still run their own loop
});

test('entering a Portal transfers the session to the target Zone at the arrival point', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const fieldPortal = channelsOf(w, 'field-01')[0].zone.portals[0];
	// Stand on the Field->Town portal and press interact.
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);

	expect(zoneOf(w, 7)).toBe('town-01');
	expect(
		channelsOf(w, 'field-01')[0].avatars.some((a) => a.sessionId === 7),
	).toBe(false);
	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.avatar.x).toBe(fieldPortal.arrival.x);
	expect(moved?.avatar.y).toBe(fieldPortal.arrival.y);
});

test('a session receives snapshots for only its current Zone', () => {
	let w = addSession(makeWorld(), 7, 'neo'); // mover
	w = addSession(w, 8, 'trinity'); // stays in the Field
	const fieldPortal = channelsOf(w, 'field-01')[0].zone.portals[0];
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
	const before = channelsOf(w, 'field-01')[0].avatars[0];
	before.progress = { level: 5, xp: 40, gold: 99 };
	before.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'epic', affixes: [] },
	];
	const fieldPortal = channelsOf(w, 'field-01')[0].zone.portals[0];
	w = stepServerWorld(w, [holdAt(7, fieldPortal.x, true)], 16);

	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.progress).toEqual({ level: 5, xp: 40, gold: 99 });
	expect(moved?.inventory.length).toBe(1);
});

test('a forgiving death respawns the Avatar in Town with full HP and no loss', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	const av = channelsOf(w, 'field-01')[0].avatars[0];
	av.avatar.hp = 1;
	av.progress = { level: 4, xp: 20, gold: 50 };
	av.inventory = [
		{ id: 1, base: 'sword', slot: 'weapon', rarity: 'rare', affixes: [] },
	];
	// Stand on a Field Monster so its contact damage finishes the Avatar this tick.
	const m = channelsOf(w, 'field-01')[0].zone.monsters[0];
	w = stepServerWorld(w, [holdAt(7, m.x)], 16);

	expect(zoneOf(w, 7)).toBe('town-01');
	expect(
		channelsOf(w, 'field-01')[0].avatars.some((a) => a.sessionId === 7),
	).toBe(false);
	const moved = zoneStateOf(w, 7)?.avatars.find((a) => a.sessionId === 7);
	expect(moved?.avatar.hp).toBe(moved?.avatar.maxHp); // full HP
	expect(moved?.avatar.x).toBe(TOWN_SPAWN.x);
	expect(moved?.progress).toEqual({ level: 4, xp: 20, gold: 50 }); // no XP/Gold loss
	expect(moved?.inventory.length).toBe(1); // no Item loss
});

test('stepServerWorld is deterministic for an identical world + intents', () => {
	const run = () => {
		const w = addSession(makeWorld(), 7, 'neo');
		const portal = channelsOf(w, 'field-01')[0].zone.portals[0];
		return stepServerWorld(w, [holdAt(7, portal.x, true)], 16);
	};
	const a = run();
	const b = run();
	expect(zoneOf(b, 7)).toBe(zoneOf(a, 7));
	const am = zoneStateOf(a, 7)?.avatars.find((x) => x.sessionId === 7);
	const bm = zoneStateOf(b, 7)?.avatars.find((x) => x.sessionId === 7);
	expect(bm?.avatar.x).toBe(am?.avatar.x);
	expect(bm?.avatar.y).toBe(am?.avatar.y);
});

test('removeSession drops a disconnected session from its Channel and the map', () => {
	let w = addSession(makeWorld(), 7, 'neo');
	w = removeSession(w, 7);
	expect(zoneOf(w, 7)).toBeUndefined();
	expect(channelsOf(w, 'field-01')[0].avatars.length).toBe(0);
	expect(removeSession(w, 99)).toBe(w); // unknown session is a no-op
});

// --- Automatic Channel routing (#39) ----------------------------------------

test('fills a Channel to the soft cap, then routes the next entrant to a new Channel', () => {
	let w = makeWorld(2); // soft cap of 2 per Channel
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');
	w = addSession(w, 3, 'c'); // past the cap -> a fresh Channel

	expect(channelOf(w, 1)).toBe(0);
	expect(channelOf(w, 2)).toBe(0);
	expect(channelOf(w, 3)).toBe(1);

	const channels = channelsOf(w, 'field-01');
	expect(channels.length).toBe(2);
	expect(channels[0].avatars.length).toBe(2);
	expect(channels[1].avatars.length).toBe(1);
});

test('Players in different Channels of one Zone cannot see each other', () => {
	let w = makeWorld(1); // each Channel holds one
	w = addSession(w, 1, 'a');
	w = addSession(w, 2, 'b');
	expect(channelOf(w, 1)).toBe(0);
	expect(channelOf(w, 2)).toBe(1);

	// Both are in field-01, but presence is scoped to the Channel.
	const view1 = worldSnapshotFor(w, 1);
	expect(view1.zoneId).toBe('field-01');
	expect(view1.avatars.map((a) => a.sessionId)).toEqual([1]);

	const view2 = worldSnapshotFor(w, 2);
	expect(view2.zoneId).toBe('field-01');
	expect(view2.avatars.map((a) => a.sessionId)).toEqual([2]);
});

test('Channel routing is deterministic for the same join sequence', () => {
	const route = () => {
		let w = makeWorld(2);
		w = addSession(w, 1, 'a');
		w = addSession(w, 2, 'b');
		w = addSession(w, 3, 'c');
		return [channelOf(w, 1), channelOf(w, 2), channelOf(w, 3)];
	};
	expect(route()).toEqual(route());
	expect(route()).toEqual([0, 0, 1]);
});

test('a cross-Zone relocation re-routes into a Channel of the destination under the cap', () => {
	let w = makeWorld(1); // each Channel holds one
	w = addSession(w, 1, 'a'); // field-01#0
	w = addSession(w, 2, 'b'); // field-01#1 (field#0 is full)
	expect(channelOf(w, 1)).toBe(0);
	expect(channelOf(w, 2)).toBe(1);

	// Both stand on the (static, per-Channel-identical) Field->Town portal.
	const portalX = channelsOf(w, 'field-01')[0].zone.portals[0].x;
	w = stepServerWorld(
		w,
		[holdAt(1, portalX, true), holdAt(2, portalX, true)],
		16,
	);

	expect(zoneOf(w, 1)).toBe('town-01');
	expect(zoneOf(w, 2)).toBe('town-01');
	// They spill across Town Channels (cap 1); ordering is deterministic by session.
	expect(channelOf(w, 1)).toBe(0);
	expect(channelOf(w, 2)).toBe(1);
	expect(channelsOf(w, 'town-01').length).toBe(2);
});

test('a leaver frees a slot the next entrant backfills (lowest Channel with room)', () => {
	let w = makeWorld(2);
	w = addSession(w, 1, 'a'); // field#0
	w = addSession(w, 2, 'b'); // field#0 (now full)
	w = addSession(w, 3, 'c'); // field#1
	w = removeSession(w, 1); // field#0 has room again

	w = addSession(w, 4, 'd'); // backfills the lowest Channel with room
	expect(channelOf(w, 4)).toBe(0);
	expect(channelsOf(w, 'field-01')[0].avatars.length).toBe(2);
	expect(channelsOf(w, 'field-01')[1].avatars.length).toBe(1);
});

test('sessionsInChannel returns every session sharing a Channel, including itself', () => {
	let w = addSession(makeWorld(), 1, 'a');
	w = addSession(w, 2, 'b'); // same Channel (generous cap)
	expect(sessionsInChannel(w, 1).sort()).toEqual([1, 2]);
	expect(sessionsInChannel(w, 2).sort()).toEqual([1, 2]);
});

test('sessionsInChannel excludes sessions in another Channel of the same Zone', () => {
	let w = makeWorld(1); // each Channel holds one
	w = addSession(w, 1, 'a'); // field-01#0
	w = addSession(w, 2, 'b'); // field-01#1
	expect(sessionsInChannel(w, 1)).toEqual([1]);
	expect(sessionsInChannel(w, 2)).toEqual([2]);
});

test('sessionsInChannel excludes a session that has left for another Zone', () => {
	let w = addSession(makeWorld(), 1, 'a'); // both start in field-01#0
	w = addSession(w, 2, 'b');
	const portal = channelsOf(w, 'field-01')[0].zone.portals[0];
	// Session 1 walks the portal to Town; session 2 stays in the Field.
	w = stepServerWorld(w, [holdAt(1, portal.x, true), holdAt(2, 60)], 16);
	expect(zoneOf(w, 1)).toBe('town-01');
	expect(sessionsInChannel(w, 1)).toEqual([1]); // alone in Town
	expect(sessionsInChannel(w, 2)).toEqual([2]); // alone in the Field
});

test('sessionsInChannel is empty for an unknown / unplaced session', () => {
	const w = addSession(makeWorld(), 1, 'a');
	expect(sessionsInChannel(w, 99)).toEqual([]);
});
