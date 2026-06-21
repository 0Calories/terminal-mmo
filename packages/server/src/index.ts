// @mmo/server — the M2 authoritative server (ADR 0006). One Bun WebSocket
// endpoint runs the shared multi-Zone world: a Field and a Town, each ticking its
// own simulation at ~20 Hz over binary frames. The server owns every consequence
// (Monster AI/HP, hit resolution, Avatar HP / death / respawn, loot, XP) and which
// Zone each session occupies (#33), but never simulates Avatar physics from input
// — it trusts the client-reported position (loose bounds clamp only), per ADR 0001.

import {
	type AvatarIntent,
	addSession,
	createServerWorld,
	createZoneState,
	decodeClientMessage,
	encodeServerMessage,
	makeFieldZone,
	makeTownZone,
	removeSession,
	type ServerWorld,
	stepServerWorld,
	worldSnapshotFor,
	zoneOf,
} from '@mmo/shared';
import type { ServerWebSocket } from 'bun';

const PORT = Number(process.env.MMO_PORT) || 8080;
const TICK_RATE = 20; // Hz (ADR 0002 / PRD cadence)
const MS_PER_TICK = 1000 / TICK_RATE;

interface WsData {
	sessionId: number;
}

const START_ZONE = 'field-01';
const TOWN_ZONE = 'town-01';
let world: ServerWorld = createServerWorld({
	zones: [
		createZoneState(makeFieldZone(START_ZONE)),
		createZoneState(makeTownZone(TOWN_ZONE)),
	],
	start: START_ZONE,
	town: TOWN_ZONE,
});

let nextSessionId = 1;
const sockets = new Map<number, ServerWebSocket<WsData>>(); // joined sessions
const intents = new Map<number, AvatarIntent>(); // latest reported intent

const clamp = (v: number, hi: number) =>
	Number.isFinite(v) ? Math.max(0, Math.min(v, hi)) : 0;

function onMessage(ws: ServerWebSocket<WsData>, raw: Uint8Array) {
	const msg = decodeClientMessage(raw);
	const { sessionId } = ws.data;
	if (msg.t === 'hello') {
		world = addSession(world, sessionId, msg.handle);
		sockets.set(sessionId, ws);
		const zoneId = zoneOf(world, sessionId) ?? START_ZONE;
		ws.send(
			encodeServerMessage({
				t: 'welcome',
				sessionId,
				zoneId,
				tickRate: TICK_RATE,
			}),
		);
		console.log(`session ${sessionId} (${msg.handle}) joined ${zoneId}`);
		return;
	}
	// input: trust the reported position with only a loose bounds clamp (against the
	// session's current Zone) — the server never re-simulates Avatar physics.
	const zoneId = zoneOf(world, sessionId);
	if (zoneId === undefined) return; // input before hello; ignore
	const terrain = world.zones[zoneId].zone.terrain;
	intents.set(sessionId, {
		sessionId,
		x: clamp(msg.x, terrain.w),
		y: clamp(msg.y, terrain.h),
		vx: msg.vx,
		vy: msg.vy,
		facing: msg.facing,
		onGround: msg.onGround,
		attack: msg.attack,
		interact: msg.interact,
		skill: msg.skill,
	});
}

function tick() {
	world = stepServerWorld(world, [...intents.values()], MS_PER_TICK);
	for (const [sessionId, ws] of sockets)
		ws.send(encodeServerMessage(worldSnapshotFor(world, sessionId)));
}

const server = Bun.serve<WsData>({
	port: PORT,
	fetch(req, srv) {
		if (srv.upgrade(req, { data: { sessionId: nextSessionId++ } })) return;
		return new Response('terminal-mmo server — connect over WebSocket', {
			status: 426,
		});
	},
	websocket: {
		message(ws, message) {
			const bytes =
				typeof message === 'string'
					? new TextEncoder().encode(message)
					: new Uint8Array(message);
			try {
				onMessage(ws, bytes);
			} catch (err) {
				console.error('bad frame from session', ws.data.sessionId, err);
			}
		},
		close(ws) {
			const { sessionId } = ws.data;
			sockets.delete(sessionId);
			intents.delete(sessionId);
			world = removeSession(world, sessionId);
			console.log(`session ${sessionId} left`);
		},
	},
});

setInterval(tick, MS_PER_TICK);

console.log(
	`@mmo/server ticking the world at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
);
