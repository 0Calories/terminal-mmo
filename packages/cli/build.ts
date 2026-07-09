import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const outdir = join(here, 'dist');
const outfile = join(outdir, 'cli.js');

const version = process.env.MMO_VERSION ?? 'dev';

const spritesDir = join(here, '..', '..', 'sprites');
const embeddedSprites: Record<string, string> = {};
try {
	const entries = readdirSync(spritesDir, { recursive: true }) as string[];
	for (const entry of entries) {
		if (!entry.endsWith('.sprite')) continue;
		const key = entry.slice(0, -'.sprite'.length).split(/[\\/]/).join('/');
		embeddedSprites[key] = readFileSync(join(spritesDir, entry), 'utf8');
	}
} catch {
	// No sprites dir — ship with an empty embedded map.
}

const result = await Bun.build({
	entrypoints: [join(here, '..', 'client', 'src', 'index.ts')],
	target: 'bun',
	outdir,
	naming: 'cli.js',
	// Native FFI renderer must stay installed, never bundled.
	external: ['@opentui/core'],
	define: {
		'process.env.MMO_VERSION': JSON.stringify(version),
		MMO_EMBEDDED_SPRITES: JSON.stringify(embeddedSprites),
	},
	banner: '#!/usr/bin/env bun',
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

chmodSync(outfile, 0o755);
console.log(
	`built ${outfile} (version ${version}, ${Object.keys(embeddedSprites).length} sprite sources embedded)`,
);
