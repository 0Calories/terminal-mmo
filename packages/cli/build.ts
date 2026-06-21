// Builds the publishable `terminal-mmo` CLI (ADR 0009): one bundled file with our
// first-party code (the client + @mmo/shared) inlined, `@opentui/core` left
// external so npm/Bun resolves its platform-specific native renderer at install.
// Run from the repo root via `bun run build:cli`.
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const outdir = join(here, 'dist');
const outfile = join(outdir, 'cli.js');

const result = await Bun.build({
	entrypoints: [join(here, '..', 'client', 'src', 'index.ts')],
	target: 'bun',
	outdir,
	naming: 'cli.js',
	// Native FFI renderer — must stay an installed dependency, never bundled.
	external: ['@opentui/core'],
	// Prepended verbatim, so the shebang lands on line 1 and the artifact runs as
	// an executable under `bunx`.
	banner: '#!/usr/bin/env bun',
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

chmodSync(outfile, 0o755);
console.log(`built ${outfile}`);
