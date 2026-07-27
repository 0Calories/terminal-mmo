import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeContractHash, loadAssetEntries } from '@mmo/assets';
import { type BuildStamp, parseStamp } from '@mmo/core/release';

const here = import.meta.dir;
const outdir = join(here, 'dist');
const outfile = join(outdir, 'cli.js');

function readStamp(): BuildStamp | undefined {
	let json: string;
	try {
		json = readFileSync(join(here, '..', '..', 'build-info.json'), 'utf8');
	} catch {
		return undefined;
	}
	return parseStamp(json);
}

const stamp = readStamp();
const version = stamp?.version ?? 'dev';
const gitSha = stamp?.gitSha ?? 'dev';

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
		'process.env.MMO_GIT_SHA': JSON.stringify(gitSha),
		MMO_EMBEDDED_ASSETS: JSON.stringify(embeddedAssets),
		MMO_CONTRACT_HASH: JSON.stringify(
			computeContractHash(join(here, '..', '..')),
		),
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
