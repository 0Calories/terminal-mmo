import { expect, test } from 'bun:test';
import type { Entity, Npc } from '@mmo/core/entities';
import { Compositor } from '@mmo/render/compositor';
import { type ActorCategory, sortActorsByDepth } from '@mmo/render/scene';
import {
	actorFootDepth,
	npcFootDepth,
	paintActor,
	paintNpc,
} from '@mmo/render/sprites';

const NO_CAM = { x: 0, y: 0 };

function ent(over: Partial<Entity> & Pick<Entity, 'id'>): Entity {
	return {
		type: 'chaser',
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 20,
		maxHp: 20,
		hurtT: 0,
		attackT: 0,
		...over,
	};
}

interface CrowdMember {
	footY: number;
	category: ActorCategory;
	id: number;
	paint: (c: Compositor) => void;
}

function monsterMember(e: Entity): CrowdMember {
	return {
		footY: actorFootDepth(e),
		category: 'monster',
		id: e.id,
		paint: (comp) => paintActor(comp, e, NO_CAM),
	};
}
function avatarMember(e: Entity): CrowdMember {
	return {
		footY: actorFootDepth(e),
		category: 'avatar',
		id: e.id,
		paint: (comp) => paintActor(comp, e, NO_CAM),
	};
}
function npcMember(n: Npc): CrowdMember {
	return {
		footY: npcFootDepth(n),
		category: 'npc',
		id: n.id,
		paint: (comp) => paintNpc(comp, n, NO_CAM),
	};
}

// Paint a crowd exactly as the client pass 3 does: foot-depth sorted, each member
// drawn atomically as one call.
function paintCrowd(c: Compositor, members: readonly CrowdMember[]): void {
	for (const m of sortActorsByDepth(members)) m.paint(c);
}

function soloOf(
	w: number,
	h: number,
	paint: (c: Compositor) => void,
): Compositor {
	const c = new Compositor(w, h);
	paint(c);
	return c;
}

// Every fully-opaque `█` cell of `front`'s solo render survives intact in
// `combined`: an all-four-quadrant front pixel cannot be sub-cell merged, so if
// anything drawn behind it appeared there the char or colour would change. This
// is the atomic-front invariant, robust to legitimate silhouette-edge merging.
function frontIsIntact(combined: Compositor, front: Compositor): void {
	const f = front.surface();
	const g = combined.surface();
	let checked = 0;
	for (let y = 0; y < f.length; y++)
		for (let x = 0; x < f[y].length; x++) {
			const fc = f[y][x];
			if (fc.char !== '█') continue;
			checked++;
			const gc = g[y][x];
			expect(gc.char).toBe('█');
			expect([...gc.fg]).toEqual([...fc.fg]);
		}
	expect(checked).toBeGreaterThan(0);
}

function anyBlankBecomesInk(combined: Compositor, front: Compositor): boolean {
	const f = front.surface();
	const g = combined.surface();
	for (let y = 0; y < f.length; y++)
		for (let x = 0; x < f[y].length; x++)
			if (f[y][x].char === ' ' && g[y][x].char !== ' ') return true;
	return false;
}

test('a forward actor draws atomically over a rear actor, hat and all', () => {
	const W = 20;
	const H = 14;
	// Rear: a hatted player (baseline 1) whose feet sit at y+6. Front: a brute
	// planted one row lower so its feet (y+5=9) land in front of the player (8).
	const rear = ent({
		id: 1,
		type: 'player',
		x: 2,
		y: 2,
		cosmetics: { hue: 2, hat: 'cap', nameplate: 0, form: 'buddy' },
	});
	const front = ent({ id: 2, type: 'brute', x: 6, y: 4 });
	expect(actorFootDepth(front)).toBeGreaterThan(actorFootDepth(rear));

	const combined = new Compositor(W, H);
	paintCrowd(combined, [avatarMember(front), monsterMember(rear)]);

	const frontSolo = soloOf(W, H, (c) => paintActor(c, front, NO_CAM));
	// The front brute is wholly intact — no rear body or hat pixel overrides any
	// of its cells, proving each actor draws as one atomic unit back-to-front.
	frontIsIntact(combined, frontSolo);
	// And the rear player still shows where the brute does not cover it.
	const rearSolo = soloOf(W, H, (c) => paintActor(c, rear, NO_CAM));
	expect(anyBlankBecomesInk(combined, frontSolo)).toBe(true);
	expect(
		rearSolo.surface().some((row) => row.some((cell) => cell.char !== ' ')),
	).toBe(true);
});

test('at equal foot depth an NPC stays behind an overlapping monster', () => {
	const W = 20;
	const H = 14;
	const npc: Npc = {
		id: 1,
		kind: 'vendor',
		name: 'Mira',
		x: 4,
		y: 4,
		w: 4,
		h: 5,
	};
	const mon = ent({ id: 2, type: 'brute', x: 6, y: 4 });
	// Same planted foot depth: the tie must resolve by category, not by chance.
	expect(npcFootDepth(npc)).toBe(actorFootDepth(mon));

	const combined = new Compositor(W, H);
	paintCrowd(combined, [monsterMember(mon), npcMember(npc)]);

	const monSolo = soloOf(W, H, (c) => paintActor(c, mon, NO_CAM));
	// The monster (drawn later) owns every one of its cells over the NPC behind it.
	frontIsIntact(combined, monSolo);
});

test('the local avatar stays on top of a nearer-footed crowd actor', () => {
	const W = 20;
	const H = 14;
	// A remote brute planted well in front of the local avatar (larger foot depth):
	// by depth alone it would occlude the avatar, but pass 4 draws the local last.
	const crowdBrute = ent({ id: 9, type: 'brute', x: 6, y: 6 });
	const local = ent({
		id: 1,
		type: 'player',
		x: 6,
		y: 2,
		cosmetics: { hue: 4, hat: 'cap', nameplate: 0, form: 'buddy' },
	});
	expect(actorFootDepth(crowdBrute)).toBeGreaterThan(actorFootDepth(local));

	const combined = new Compositor(W, H);
	// Pass 3: the crowd.
	paintCrowd(combined, [monsterMember(crowdBrute)]);
	// Pass 4: the local avatar, always last.
	paintActor(combined, local, NO_CAM);

	const localSolo = soloOf(W, H, (c) => paintActor(c, local, NO_CAM));
	// The local avatar is wholly intact despite the crowd actor's nearer feet.
	frontIsIntact(combined, localSolo);
});
