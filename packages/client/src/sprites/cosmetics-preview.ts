import {
	type Cosmetics,
	DEFAULT_FORM_ID,
	type Entity,
	HUES,
	NAMEPLATE_COLORS,
} from '@mmo/core/entities';
import { HAT_IDS } from '@mmo/render';
import { Compositor } from '@mmo/render/compositor';
import { drawNameplates } from '@mmo/render/scene';
import { paintActor } from '@mmo/render/sprites';

/** Read a composed surface as plain text, trimming trailing blanks per row. */
function surfaceToText(compositor: Compositor): string {
	return compositor
		.surface()
		.map((row) =>
			row
				.map((cell) => cell.char)
				.join('')
				.replace(/\s+$/, ''),
		)
		.join('\n');
}

function avatar(cosmetics: Cosmetics): Entity {
	return {
		id: 1,
		type: 'player',
		name: 'neo',
		cosmetics,
		x: 7,
		y: 3,
		vx: 0,
		vy: 0,
		speed: 0,
		facing: 1,
		onGround: true,
		hp: 10,
		maxHp: 10,
		hurtT: 0,
		attackT: 0,
	};
}

function frame(title: string, cosmetics: Cosmetics): string {
	const compositor = new Compositor(16, 11);
	const entities = [avatar(cosmetics)];
	const cam = { x: 0, y: 0 };
	for (const e of entities) paintActor(compositor, e, cam);
	drawNameplates(compositor, entities, cam);
	return `${title}\n${surfaceToText(compositor)}`;
}

console.log(
	'=== Avatar cosmetic hats (#35) — rendered through the shared renderer ===\n',
);
console.log(
	`${frame('[none] None', { hue: 0, hat: '', nameplate: 0, form: DEFAULT_FORM_ID })}\n`,
);
for (const hat of HAT_IDS)
	console.log(
		`${frame(`[${hat}] ${hat}`, { hue: 0, hat, nameplate: 0, form: DEFAULT_FORM_ID })}\n`,
	);

console.log(`=== Hue catalog (${HUES.length}) — body recolour, RGBA ===`);
for (const [i, q] of HUES.entries())
	console.log(`  [${i}] rgb(${q[0]}, ${q[1]}, ${q[2]})`);

console.log(
	`\n=== Nameplate colour catalog (${NAMEPLATE_COLORS.length}) — RGBA ===`,
);
for (const [i, q] of NAMEPLATE_COLORS.entries())
	console.log(`  [${i}] rgb(${q[0]}, ${q[1]}, ${q[2]})`);
