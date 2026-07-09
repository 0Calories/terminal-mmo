import { chmodSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const outdir = join(here, 'dist');
const outfile = join(outdir, 'cli.js');

const version = process.env.MMO_VERSION ?? 'dev';

const result = await Bun.build({
	entrypoints: [join(here, '..', 'client', 'src', 'index.ts')],
	target: 'bun',
	outdir,
	naming: 'cli.js',
	// Native FFI renderer must stay installed, never bundled.
	external: ['@opentui/core'],
	define: { 'process.env.MMO_VERSION': JSON.stringify(version) },
	banner: '#!/usr/bin/env bun',
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

chmodSync(outfile, 0o755);
console.log(`built ${outfile} (version ${version})`);
