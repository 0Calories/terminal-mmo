// @mmo/server — the M2 authoritative server (ADR 0006). One Bun WebSocket
// endpoint runs a single Field Zone's simulation at ~20 Hz over binary frames.
// It owns every consequence (Monster AI/HP, hit resolution, Avatar HP /
// death / respawn, loot, XP) but never simulates Avatar physics from input — it
// trusts the client-reported position (loose bounds clamp only), per ADR 0001.

import {
	type AvatarIntent,
	addAvatar,
	createZoneState,
	decodeClientMessage,
	encodeServerMessage,
	makeFieldZone,
	removeAvatar,
	snapshotFor,
	stepZone,
	type ZoneState,
} from '@mmo/shared';
import type { ServerWebSocket } from 'bun';

const PORT = Number(process.env.MMO_PORT) || 8080;
const TICK_RATE = 20; // Hz (ADR 0002 / PRD cadence)
const MS_PER_TICK = 1000 / TICK_RATE;

interface WsData {
	sessionId: number;
}

const ZONE_ID = 'field-01';
let zone: ZoneState = createZoneState(makeFieldZone(ZONE_ID));

let nextSessionId = 1;
const sockets = new Map<number, ServerWebSocket<WsData>>(); // joined sessions
const intents = new Map<number, AvatarIntent>(); // latest reported intent

const terrain = zone.zone.terrain;
const clamp = (v: number, hi: number) =>
	Number.isFinite(v) ? Math.max(0, Math.min(v, hi)) : 0;

function onMessage(ws: ServerWebSocket<WsData>, raw: Uint8Array) {
	const msg = decodeClientMessage(raw);
	const { sessionId } = ws.data;
	if (msg.t === 'hello') {
		zone = addAvatar(zone, sessionId, msg.handle);
		sockets.set(sessionId, ws);
		ws.send(
			encodeServerMessage({
				t: 'welcome',
				sessionId,
				zoneId: ZONE_ID,
				tickRate: TICK_RATE,
			}),
		);
		console.log(`session ${sessionId} (${msg.handle}) joined ${ZONE_ID}`);
		return;
	}
	// input: trust the reported position with only a loose bounds clamp — the
	// server never re-simulates Avatar physics.
	intents.set(sessionId, {
		sessionId,
		x: clamp(msg.x, terrain.w),
		y: clamp(msg.y, terrain.h),
		vx: msg.vx,
		vy: msg.vy,
		facing: msg.facing,
		onGround: msg.onGround,
		attack: msg.attack,
		skill: msg.skill,
	});
}

function tick() {
	zone = stepZone(zone, [...intents.values()], MS_PER_TICK);
	for (const [sessionId, ws] of sockets)
		ws.send(encodeServerMessage(snapshotFor(zone, sessionId)));
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
			zone = removeAvatar(zone, sessionId);
			console.log(`session ${sessionId} left ${ZONE_ID}`);
		},
	},
});

setInterval(tick, MS_PER_TICK);

console.log(
	`@mmo/server ticking ${ZONE_ID} at ${TICK_RATE} Hz on ws://localhost:${server.port}`,
);
