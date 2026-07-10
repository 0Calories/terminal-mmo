import { chmodSync } from 'node:fs';
import { join } from 'node:path';
// This build script runs unbundled, so loadAssetEntries takes the fs-scan
// strategy: the binary embeds exactly what the store reads in dev (ADR 0033).
import { loadAssetEntries } from '@mmo/assets';

const here = import.meta.dir;
const outdir = join(here, 'dist');
const outfile = join(outdir, 'cli.js');

const version = process.env.MMO_VERSION ?? 'dev';

const embeddedAssets = loadAssetEntries();

const result = await Bun.build({
	entrypoints: [join(here, '..', 'client', 'src', 'index.ts')],
	target: 'bun',
	outdir,
	naming: 'cli.js',
	// Native FFI renderer must stay installed, never bundled.
	external: ['@opentui/core'],
	define: {
		'process.env.MMO_VERSION': JSON.stringify(version),
		MMO_EMBEDDED_ASSETS: JSON.stringify(embeddedAssets),
	},
	banner: '#!/usr/bin/env bun',
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

chmodSync(outfile, 0o755);
console.log(
	`built ${outfile} (version ${version}, ${Object.keys(embeddedAssets).length} asset files embedded)`,
);
